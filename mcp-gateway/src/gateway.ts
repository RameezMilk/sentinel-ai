import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as http from "http";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { z } from "zod";
import { PendingRequest, OverridePayload, Risk, VerifierResponse } from "./types.js";
import { promptUserSingle, promptUserChecklist } from "./prompter.js";

const execAsync = promisify(exec);

const pending = new Map<string, PendingRequest>();
const riskIdToCommand = new Map<string, string>(); // "requestId:riskId" → command


function callVerifier(id: string, commands: string[], trace: string): void {
  const body = JSON.stringify({ id, commands, trace });
  const options = {
    hostname: "localhost",
    port: 8000,
    path: "/verify",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const req = http.request(options, (res) => {
    let raw = "";
    res.on("data", (chunk) => (raw += chunk));
    res.on("end", () => {
      // Verifier will call back via /sentinel/verify-result — response body ignored
    });
  });

  req.on("error", (err) => {
    // Verifier unreachable — fail safe: deny
    process.stderr.write(`[gateway] Verifier unreachable: ${err.message}\n`);
    const entry = pending.get(id);
    if (entry) {
      entry.reject("Verifier unreachable — action blocked.");
      pending.delete(id);
    }
  });

  req.write(body);
  req.end();
}

export function handleVerifyResult(
  body: VerifierResponse & { id: string }
): void {
  const { id } = body;
  const entry = pending.get(id);
  if (!entry) return;

  if (body.status === "VALIDATED") {
    entry.resolve(entry.commands);
    pending.delete(id);
  } else if (body.status === "SINGLE_RISK") {
    const risk: Risk = body.risk;
    riskIdToCommand.set(`${id}:${risk.id}`, risk.command);
    promptUserSingle(id, risk);
    // Promise stays pending until /sentinel/override is called
  } else if (body.status === "MULTIPLE_RISKS") {
    const risks: Risk[] = body.risks;
    for (const risk of risks) {
      riskIdToCommand.set(`${id}:${risk.id}`, risk.command);
    }
    promptUserChecklist(id, risks);
    // Promise stays pending until /sentinel/override is called
  }
}

export function handleOverride(payload: OverridePayload): void {
  const { id, approvedRiskIds } = payload;
  const entry = pending.get(id);
  if (!entry) return;

  if (approvedRiskIds.length === 1 && approvedRiskIds[0] === "*") {
    // All approved
    entry.resolve(entry.commands);
  } else if (approvedRiskIds.length === 0) {
    // All denied
    entry.reject("All actions denied by security policy.");
  } else {
    // Subset approved — resolve only the approved commands
    const approvedCommands: string[] = [];
    for (const riskId of approvedRiskIds) {
      const cmd = riskIdToCommand.get(`${id}:${riskId}`);
      if (cmd) approvedCommands.push(cmd);
    }
    entry.resolve(approvedCommands);
  }

  // Cleanup
  pending.delete(id);
  for (const key of [...riskIdToCommand.keys()]) {
    if (key.startsWith(`${id}:`)) riskIdToCommand.delete(key);
  }
}

let activeGatewayPort = 0;

export function getActivePort(): number {
  return activeGatewayPort;
}

function createRequestHandler(): http.RequestListener {
  return (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        const body = JSON.parse(raw);

        if (req.url === "/sentinel/verify-result") {
          handleVerifyResult(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else if (req.url === "/sentinel/override") {
          handleOverride(body);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404);
          res.end();
        }
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  };
}

export function startLocalHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const startPort = parseInt(process.env.GATEWAY_PORT ?? "8090", 10);

    const tryListen = (port: number): void => {
      if (port > startPort + 20) {
        reject(new Error("No free port found in range"));
        return;
      }

      const server = http.createServer(createRequestHandler());

      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          process.stderr.write(`[gateway] Port ${port} in use, trying ${port + 1}...\n`);
          tryListen(port + 1);
        } else {
          reject(err);
        }
      });

      server.listen(port, () => {
        activeGatewayPort = port;
        process.stderr.write(`[gateway] Local HTTP server listening on port ${port}\n`);
        resolve();
      });
    };

    tryListen(startPort);
  });
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "sentinelai",
    version: "1.0.0",
  });

  server.tool(
    "execute_terminal_command",
    "Execute one or more shell commands via SentinelAI governance layer",
    {
      commands: z.union([z.string(), z.array(z.string())]).describe(
        "One or more shell commands to execute"
      ),
      trace: z.string().describe("Copilot's reasoning for why it wants to run these commands"),
    },
    async ({ commands, trace }) => {
      const commandList = Array.isArray(commands) ? commands : [commands];
      const id = randomUUID();

      const approved = await new Promise<string[]>((resolve, reject) => {
        pending.set(id, { resolve, reject, commands: commandList, trace });

        // 15-second timeout
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            // Cleanup riskIdToCommand entries
            for (const key of [...riskIdToCommand.keys()]) {
              if (key.startsWith(`${id}:`)) riskIdToCommand.delete(key);
            }
            reject("Verification timed out — action blocked.");
          }
        }, 15_000);

        // Ensure timeout doesn't prevent process exit
        if (timer.unref) timer.unref();

        callVerifier(id, commandList, trace);
      });

      // Execute approved commands
      const outputs: string[] = [];
      for (const cmd of approved) {
        try {
          const { stdout, stderr } = await execAsync(cmd);
          outputs.push(`$ ${cmd}\n${stdout}${stderr ? `[stderr] ${stderr}` : ""}`);
        } catch (err: unknown) {
          const error = err as { message?: string };
          outputs.push(`$ ${cmd}\n[error] ${error.message}`);
        }
      }

      return {
        content: [{ type: "text", text: outputs.join("\n---\n") }],
      };
    }
  );

  return server;
}

export async function startGateway(): Promise<void> {
  await startLocalHttpServer();
  process.stderr.write(
    `[gateway] Tip: set GATEWAY_CALLBACK_URL=http://localhost:${activeGatewayPort}/sentinel/verify-result in verifier/.env\n`
  );

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[gateway] MCP server connected via stdio\n");
}
