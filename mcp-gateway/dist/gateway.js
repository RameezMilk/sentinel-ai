import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as http from "http";
import * as https from "https";
import { exec } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { z } from "zod";
import { promptUserSingle, promptUserChecklist } from "./prompter.js";
const execAsync = promisify(exec);
const pending = new Map();
const riskIdToCommand = new Map(); // "requestId:riskId" → command
function postJson(url, data) {
    const body = JSON.stringify(data);
    const urlObj = new URL(url);
    const lib = urlObj.protocol === "https:" ? https : http;
    const options = {
        hostname: urlObj.hostname,
        port: parseInt(urlObj.port || (urlObj.protocol === "https:" ? "443" : "80")),
        path: urlObj.pathname,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
        },
    };
    const req = lib.request(options, () => { });
    req.on("error", (err) => {
        process.stderr.write(`[gateway] POST ${url} failed: ${err.message}\n`);
    });
    req.write(body);
    req.end();
}
function callVerifier(id, commands, trace) {
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
export function handleVerifyResult(body) {
    const { id } = body;
    const entry = pending.get(id);
    if (!entry)
        return;
    if (body.status === "VALIDATED") {
        entry.resolve(entry.commands);
        pending.delete(id);
    }
    else if (body.status === "SINGLE_RISK") {
        const risk = body.risk;
        riskIdToCommand.set(`${id}:${risk.id}`, risk.command);
        promptUserSingle(id, risk);
        // Promise stays pending until /sentinel/override is called
    }
    else if (body.status === "MULTIPLE_RISKS") {
        const risks = body.risks;
        for (const risk of risks) {
            riskIdToCommand.set(`${id}:${risk.id}`, risk.command);
        }
        promptUserChecklist(id, risks);
        // Promise stays pending until /sentinel/override is called
    }
}
export function handleOverride(payload) {
    const { id, approvedRiskIds } = payload;
    const entry = pending.get(id);
    if (!entry)
        return;
    if (approvedRiskIds.length === 1 && approvedRiskIds[0] === "*") {
        // All approved
        entry.resolve(entry.commands);
    }
    else if (approvedRiskIds.length === 0) {
        // All denied
        entry.reject("All actions denied by security policy.");
    }
    else {
        // Subset approved — resolve only the approved commands
        const approvedCommands = [];
        for (const riskId of approvedRiskIds) {
            const cmd = riskIdToCommand.get(`${id}:${riskId}`);
            if (cmd)
                approvedCommands.push(cmd);
        }
        entry.resolve(approvedCommands);
    }
    // Cleanup
    pending.delete(id);
    for (const key of [...riskIdToCommand.keys()]) {
        if (key.startsWith(`${id}:`))
            riskIdToCommand.delete(key);
    }
}
export function startLocalHttpServer() {
    const server = http.createServer((req, res) => {
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
                }
                else if (req.url === "/sentinel/override") {
                    handleOverride(body);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                }
                else {
                    res.writeHead(404);
                    res.end();
                }
            }
            catch {
                res.writeHead(400);
                res.end();
            }
        });
    });
    server.listen(8001, () => {
        process.stderr.write("[gateway] Local HTTP server listening on port 8001\n");
    });
}
export function createMcpServer() {
    const server = new McpServer({
        name: "sentinelai",
        version: "1.0.0",
    });
    server.tool("execute_terminal_command", "Execute one or more shell commands via SentinelAI governance layer", {
        commands: z.union([z.string(), z.array(z.string())]).describe("One or more shell commands to execute"),
        trace: z.string().describe("Copilot's reasoning for why it wants to run these commands"),
    }, async ({ commands, trace }) => {
        const commandList = Array.isArray(commands) ? commands : [commands];
        const id = randomUUID();
        const approved = await new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject, commands: commandList, trace });
            // 15-second timeout
            const timer = setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    // Cleanup riskIdToCommand entries
                    for (const key of [...riskIdToCommand.keys()]) {
                        if (key.startsWith(`${id}:`))
                            riskIdToCommand.delete(key);
                    }
                    reject("Verification timed out — action blocked.");
                }
            }, 15_000);
            // Ensure timeout doesn't prevent process exit
            if (timer.unref)
                timer.unref();
            callVerifier(id, commandList, trace);
        });
        // Execute approved commands
        const outputs = [];
        for (const cmd of approved) {
            try {
                const { stdout, stderr } = await execAsync(cmd);
                outputs.push(`$ ${cmd}\n${stdout}${stderr ? `[stderr] ${stderr}` : ""}`);
            }
            catch (err) {
                const error = err;
                outputs.push(`$ ${cmd}\n[error] ${error.message}`);
            }
        }
        return {
            content: [{ type: "text", text: outputs.join("\n---\n") }],
        };
    });
    return server;
}
export async function startGateway() {
    startLocalHttpServer();
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("[gateway] MCP server connected via stdio\n");
}
//# sourceMappingURL=gateway.js.map