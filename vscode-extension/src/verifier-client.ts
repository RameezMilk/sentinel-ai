import * as http from "http";
import { CheckIntentResponse, VerifierResponse } from "./types.js";

function post(path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "localhost",
        port: 8000,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Invalid JSON: ${raw}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error("Request timed out after 15s"));
    });
    req.write(data);
    req.end();
  });
}

export async function checkIntent(
  id: string,
  prompt: string
): Promise<CheckIntentResponse> {
  return post("/check-intent", { id, trace: prompt }) as Promise<CheckIntentResponse>;
}

export async function verifyCommands(
  id: string,
  commands: string[],
  trace: string
): Promise<VerifierResponse> {
  return post("/verify", { id, commands, trace }) as Promise<VerifierResponse>;
}

export async function postExecutionResult(
  requestId: string,
  command: string,
  approved: boolean,
  agentId: string,
  trace: string
): Promise<void> {
  await post("/execution-result", { id: requestId, command, approved, agent_id: agentId, trace });
}

export async function postIntentResult(
  requestId: string,
  trace: string,
  decision: "accepted" | "rejected",
  violations: import("./types.js").IntentViolation[]
): Promise<void> {
  await post("/intent-result", { id: requestId, trace, decision, violations });
}
