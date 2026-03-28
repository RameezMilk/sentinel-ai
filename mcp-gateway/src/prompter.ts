import * as readline from "readline";
import * as http from "http";
import { Risk } from "./types.js";

function postOverride(id: string, approvedRiskIds: string[]): void {
  const body = JSON.stringify({ id, approvedRiskIds });
  const options = {
    hostname: "localhost",
    port: 8001,
    path: "/sentinel/override",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const req = http.request(options, () => {});
  req.on("error", (err) => {
    process.stderr.write(`[prompter] Failed to POST override: ${err.message}\n`);
  });
  req.write(body);
  req.end();
}

export function promptUserSingle(id: string, risk: Risk): void {
  process.stderr.write(
    `\n⚠  RISK DETECTED\n` +
    `   Command : ${risk.command}\n` +
    `   Reason  : ${risk.reason}\n` +
    `   Source  : ${risk.source}\n\n` +
    `   Proceed? (y/n): `
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  rl.once("line", (answer) => {
    rl.close();
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "y") {
      postOverride(id, ["*"]);
    } else {
      postOverride(id, []);
    }
  });
}

export function promptUserChecklist(id: string, risks: Risk[]): void {
  let prompt = `\n⚠  ${risks.length} RISKS DETECTED — select which to allow:\n\n`;
  risks.forEach((risk, i) => {
    prompt += `   [${i + 1}] ${risk.command}\n`;
    prompt += `       ${risk.reason} (${risk.source})\n\n`;
  });
  prompt += `   Enter numbers to approve (e.g. 1,3) or "none" to deny all: `;

  process.stderr.write(prompt);

  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });

  rl.once("line", (answer) => {
    rl.close();
    const trimmed = answer.trim().toLowerCase();

    let approvedRiskIds: string[] = [];
    if (trimmed !== "none" && trimmed !== "") {
      const indices = trimmed.split(",").map((s) => parseInt(s.trim(), 10));
      approvedRiskIds = indices
        .filter((n) => !isNaN(n) && n >= 1 && n <= risks.length)
        .map((n) => risks[n - 1].id);
    }

    postOverride(id, approvedRiskIds);
  });
}
