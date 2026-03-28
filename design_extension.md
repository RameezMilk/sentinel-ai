# SentinelAI — VS Code Extension Build Prompt

## Project overview

Build SentinelAI: a runtime governance layer implemented as a native VS Code extension that intercepts GitHub Copilot chat requests and file edits before the Copilot model is invoked, routes them through a Python Verifier API for risk analysis, displays native VS Code approval dialogs for risky actions, logs all risk events immutably to Solana devnet, and emits structured JSON events for downstream dashboard consumption.

The extension owns the chat entry point. Every user message passes through SentinelAI before reaching the Copilot model. Blocking is structural — the model is never called if a request is blocked — not instruction-based.

---

## Repository structure

```
sentinelai/
├── vscode-extension/             # TypeScript — VS Code extension
│   ├── src/
│   │   ├── extension.ts          # activate/deactivate, registration
│   │   ├── guardian.ts           # chat participant requestHandler
│   │   ├── file-guard.ts         # onWillSaveTextDocument enforcement
│   │   ├── verifier-client.ts    # HTTP client for verifier API
│   │   ├── verifier-process.ts   # spawn/manage Python verifier subprocess
│   │   └── types.ts              # shared TS types
│   ├── package.json              # extension manifest (contributes, engines)
│   └── tsconfig.json
│
├── verifier/                     # Python — all risk analysis (largely unchanged)
│   ├── main.py                   # FastAPI app entry point
│   ├── scanner.py                # regex-based shell risk scan
│   ├── auditor.py                # Gemini RISKS.md audit (intent + commands)
│   ├── logger.py                 # Solana devnet transaction logger
│   ├── models.py                 # Pydantic models (request/response/events)
│   └── requirements.txt
│
├── RISKS.md                      # governance policy file (editable, project root)
└── README.md
```

---

## 1. VS Code Extension (TypeScript)

### `src/types.ts`

Define these exact types:

```typescript
export type Risk = {
  id: string;
  command: string;
  reason: string;
  source: "regex" | "risks_md";
};

export type IntentViolation = {
  subject: string;
  reason: string;
  policy_excerpt: string;
};

export type CheckIntentResponse = {
  id: string;
  status: "APPROVED" | "BLOCKED";
  violations: IntentViolation[];
};

export type VerifierResponse =
  | { status: "VALIDATED"; id: string }
  | { status: "SINGLE_RISK"; id: string; risk: Risk }
  | { status: "MULTIPLE_RISKS"; id: string; risks: Risk[] };
```

No `PendingRequest`, `OverridePayload`, or callback map types are needed.
The extension calls the verifier synchronously and reads the HTTP response body directly.

---

### `src/verifier-process.ts`

Manages the Python verifier subprocess. Called from `extension.ts` on activation.

```typescript
export class VerifierProcess {
  private proc: ChildProcess | null = null;

  async start(verifierDir: string): Promise<void>
  // Locate uvicorn: prefer verifierDir/.venv/Scripts/uvicorn (Windows) or
  // verifierDir/.venv/bin/uvicorn (Unix), fall back to PATH.
  // Spawn: uvicorn main:app --port 8000 --log-level warning
  // cwd: verifierDir
  // env: inherit process.env, override RISKS_MD_PATH to the workspace root RISKS.md
  // Pipe stderr to VS Code Output Channel named "SentinelAI Verifier".
  // Poll GET http://localhost:8000/docs every 500ms, resolve when HTTP 200, timeout after 15s.

  stop(): void
  // Kill the subprocess on extension deactivation.
}
```

---

### `src/verifier-client.ts`

Thin HTTP client over Node.js `http`. No callback pattern — all calls are direct
request/response. Returns parsed JSON or throws on error.

```typescript
export async function checkIntent(
  id: string,
  prompt: string
): Promise<CheckIntentResponse>
// POST http://localhost:8000/check-intent
// Body: { id, trace: prompt }
// Returns parsed CheckIntentResponse.

export async function verifyCommands(
  id: string,
  commands: string[],
  trace: string
): Promise<VerifierResponse>
// POST http://localhost:8000/verify
// Body: { id, commands, trace }
// Returns parsed VerifierResponse directly from HTTP response body.
// No callback URL. No pendingVerify map. No local HTTP server.

export async function postExecutionResult(
  requestId: string,
  command: string,
  approved: boolean,
  agentId: string,
  trace: string
): Promise<void>
// POST http://localhost:8000/execution-result
```

---

### `src/guardian.ts`

The chat participant request handler. This is the primary enforcement point.

```typescript
export async function handleRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void>
```

Implement this exact logic:

1. Generate a UUID request ID.
2. Call `checkIntent(id, request.prompt)`.
   - On network error (verifier not running): write a BLOCKED message to `stream`
     explaining SentinelAI is unreachable, then return. Fail closed — never forward
     to the model if the verifier cannot be reached.
3. If `status === "BLOCKED"`:
   - Write to stream:
     ```
     **SentinelAI blocked this request**

     The following policy violations were detected:

     - **<subject>**: <reason>
       Policy: <policy_excerpt>

     This request has not been forwarded to Copilot.
     Edit your request to comply with the project governance policy (RISKS.md).
     ```
   - Return. The Copilot model is never invoked.
4. If `status === "APPROVED"`:
   - Select a Copilot language model: `vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4o" })`.
   - Build chat messages from `request.prompt` and `context.history`.
   - Call `model.sendRequest(messages, {}, token)`.
   - Stream each text chunk to `stream.markdown(chunk)`.

---

### `src/file-guard.ts`

Registers a `vscode.workspace.onWillSaveTextDocument` listener on extension activation.
This fires synchronously before every file write, including Copilot-generated edits.

```typescript
export function registerFileGuard(
  context: vscode.ExtensionContext
): void
```

Implement this exact logic:

1. On `onWillSaveTextDocument`, generate a UUID.
2. Build a prompt string:
   `"Save file: <relativePath> — <lineCount> lines, reason: <save reason>"`
3. Call `checkIntent(id, prompt)` and wrap the result in `event.waitUntil(promise)`.
   - `waitUntil` accepts a `Thenable`. If the thenable resolves, the save proceeds.
   - If `status === "BLOCKED"`: reject the thenable and show a
     `vscode.window.showErrorMessage` with the first violation reason.
     The file save is cancelled. This is a hard veto — not advisory.
   - If `status === "APPROVED"`: resolve the thenable. Save proceeds normally.

---

### `src/extension.ts`

```typescript
import * as vscode from "vscode";
import { VerifierProcess } from "./verifier-process.js";
import { registerFileGuard } from "./file-guard.js";
import { handleRequest } from "./guardian.js";
import * as path from "path";

const verifierProcess = new VerifierProcess();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const verifierDir = path.join(workspaceRoot, "verifier");

  // Start the Python verifier subprocess
  await verifierProcess.start(verifierDir);

  // Register chat participant
  const participant = vscode.chat.createChatParticipant("sentinelai.guard", handleRequest);
  participant.iconPath = new vscode.ThemeIcon("shield");
  context.subscriptions.push(participant);

  // Register file save guard
  registerFileGuard(context);

  vscode.window.showInformationMessage("SentinelAI governance is active.");
}

export function deactivate(): void {
  verifierProcess.stop();
}
```

---

### `package.json` (extension manifest)

Key fields that differ from a plain Node project:

```json
{
  "name": "sentinelai",
  "displayName": "SentinelAI",
  "description": "Runtime governance layer for GitHub Copilot",
  "version": "0.1.0",
  "engines": { "vscode": "^1.99.0" },
  "categories": ["AI", "Other"],
  "activationEvents": ["onStartupFinished"],
  "main": "./dist/extension.js",
  "contributes": {
    "chatParticipants": [
      {
        "id": "sentinelai.guard",
        "name": "sentinelai-guard",
        "description": "SentinelAI governance layer — screens every request before Copilot responds",
        "isSticky": true
      }
    ],
    "configuration": {
      "title": "SentinelAI",
      "properties": {
        "sentinelai.verifierPort": {
          "type": "number",
          "default": 8000,
          "description": "Port the Python verifier API listens on"
        },
        "sentinelai.geminiApiKey": {
          "type": "string",
          "default": "",
          "description": "Gemini API key for RISKS.md policy auditing"
        },
        "sentinelai.risksPath": {
          "type": "string",
          "default": "${workspaceFolder}/RISKS.md",
          "description": "Path to the governance policy file"
        }
      }
    }
  },
  "dependencies": {},
  "devDependencies": {
    "@types/vscode": "^1.99.0",
    "@types/node": "latest",
    "typescript": "^5.0.0",
    "@vscode/vsce": "latest"
  }
}
```

`isSticky: true` means VS Code remembers `@sentinelai-guard` as the active participant
across turns in the same conversation.

---

## 2. Verifier API (Python / FastAPI)

The verifier is largely unchanged. The following specific changes apply.

### `main.py` changes

**Remove** the `httpx` callback POST to `GATEWAY_CALLBACK_URL` from the `/verify` endpoint.
In the extension architecture the extension reads the HTTP response body directly —
there is no gateway to call back.

```python
# Remove this block from /verify:
try:
    async with httpx.AsyncClient(timeout=10.0) as client:
        await client.post(GATEWAY_CALLBACK_URL, json=response_dict)
except Exception as exc:
    logger.error("Failed to POST verify-result to gateway: %s", exc)
```

The endpoint still returns `JSONResponse(content=response_dict)` — the extension reads this.

**Keep** `/check-intent` and `/execution-result` unchanged.

**Remove** `httpx` from imports in `main.py` (no longer needed).

### `models.py` changes

Keep all models from the MCP design plus the additions made for intent checking:
`IntentCheckRequest`, `IntentCheckResponse`, `IntentViolation`.

The `DashboardEvent.event_type` literal set gains one new value:

```python
event_type: Literal[
    "risk_detected",
    "human_approved",
    "human_denied",
    "executed",
    "timeout",
    "intent_blocked",   # new — emitted when /check-intent returns BLOCKED
]
```

### `auditor.py`

Unchanged. Audits both commands and intent (trace) against RISKS.md.

### `scanner.py`

Unchanged. All 11 regex patterns retained.

### `logger.py`

Unchanged. Solana devnet logging, keypair generation, airdrop.

### `requirements.txt` changes

Remove `httpx` — no longer needed by the verifier.

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
pydantic>=2.0.0
google-generativeai>=0.5.0
solana>=0.34.0
solders>=0.21.0
python-dotenv>=1.0.0
```

---

## 3. Environment variables

| Variable | Default | Used by | Change from MCP design |
|---|---|---|---|
| `VERIFIER_PORT` | `8000` | verifier/main.py | Unchanged |
| `GEMINI_API_KEY` | required | verifier/auditor.py | Unchanged |
| `SOLANA_KEYPAIR_PATH` | `~/.config/solana/id.json` | verifier/logger.py | Unchanged |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | verifier/logger.py | Unchanged |
| `RISKS_MD_PATH` | `../RISKS.md` | verifier/auditor.py | Points to project root |
| `AGENT_ID` | `copilot-default` | verifier/main.py | Unchanged |
| `GATEWAY_CALLBACK_URL` | — | — | **Removed** — extension reads HTTP response directly |

Extension-specific configuration is handled via VS Code settings (`sentinelai.*`)
rather than environment variables, so it is user-visible and workspace-scoped.

---

## 4. Approval flow

In the MCP design, approval required two separate MCP tool calls (`approve_command`,
`deny_command`) because the MCP protocol cannot block mid-response. The extension
replaces this with a native VS Code modal dialog that suspends execution on the
extension's async thread until the user responds.

```typescript
// In guardian.ts, when /verify returns SINGLE_RISK or MULTIPLE_RISKS:
const choice = await vscode.window.showWarningMessage(
  `SentinelAI: Risk detected in command\n\n${risk.command}\n\nReason: ${risk.reason}`,
  { modal: true },
  "Allow",
  "Block"
);

if (choice === "Allow") {
  // execute the command, post execution-result approved=true
} else {
  // do not execute, post execution-result approved=false
  stream.markdown(`Command blocked: ${risk.reason}`);
}
```

The dialog suspends the async function. No pending maps, no second tool call,
no `awaitingApproval` state. The user sees a native OS-level modal — it cannot
be ignored or bypassed by continuing to type in the chat panel.

---

## 5. Dashboard JSON contract

Unchanged from the MCP design. Each `DashboardEvent` is emitted as newline-delimited
JSON on the verifier's stdout. The new `intent_blocked` event type follows the same
schema with `risk: null`.

---

## 6. Build and run instructions

```bash
# Terminal 1 — Verifier API (only service needed; extension manages it automatically
# in production, but can be run manually for debugging)
cd verifier
pip install -r requirements.txt
uvicorn main:app --port 8000

# Install extension in VS Code (development)
cd vscode-extension
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host

# Install extension from VSIX (production)
cd vscode-extension
npx vsce package
code --install-extension sentinelai-0.1.0.vsix
```

In the extension development host, open any workspace. The extension activates
on startup, spawns the verifier, and registers `@sentinelai-guard` in the
Copilot chat panel. Use `@sentinelai-guard <your request>` to route messages
through governance before Copilot responds.

---

## 7. Constraints and failure modes

- **Fail closed on verifier unreachable**: if the verifier process fails to start
  or crashes, `guardian.ts` must write a BLOCKED message and return on every request.
  Never forward to the Copilot model if health check fails.
- **File guard fail closed**: if `/check-intent` throws on `onWillSaveTextDocument`,
  reject the save. Never default to allowing the save on error.
- **Timeout**: 15 seconds for `/check-intent` and `/verify`. On timeout, treat as
  BLOCKED. Emit a `timeout` DashboardEvent.
- **Solana errors**: unchanged — never block main flow, log to stderr.
- **Gemini errors**: unchanged — treat as zero Gemini violations, regex scan is
  the hard gate.
- **Modal dialog dismissed**: if the user closes the approval modal without clicking
  Allow or Block, treat as Block.
- **Extension not active**: VS Code shows a native error if `@sentinelai-guard` is
  referenced while the extension is disabled. No silent bypass.
- **Deduplication, partial approval, concurrent scan**: unchanged from MCP design.
