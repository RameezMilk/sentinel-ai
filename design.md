# SentinelAI — Claude Code Build Prompt

## Project overview

Build SentinelAI: a runtime governance layer that intercepts GitHub Copilot (VS Code extension) tool calls via an MCP server, routes them through a Python Verifier API for risk analysis, logs all risk events immutably to Solana devnet, and emits structured JSON events for downstream dashboard consumption.

---

## Repository structure

Scaffold the following layout exactly:

```
sentinelai/
├── mcp-gateway/              # TypeScript — MCP server only
│   ├── src/
│   │   ├── index.ts          # MCP server entry point
│   │   ├── gateway.ts        # pause/resume Promise logic
│   │   ├── prompter.ts       # VS Code terminal y/n + checklist
│   │   └── types.ts          # shared TS types
│   ├── package.json
│   └── tsconfig.json
│
├── verifier/                 # Python — all risk analysis
│   ├── main.py               # FastAPI app entry point
│   ├── scanner.py            # regex-based file/shell risk scan
│   ├── auditor.py            # Gemini risks.md audit
│   ├── logger.py             # Solana devnet transaction logger
│   ├── models.py             # Pydantic models (request/response/events)
│   ├── risks.md              # governance policy file (editable)
│   └── requirements.txt
│
└── README.md
```

---

## 1. MCP Gateway (TypeScript)

### `src/types.ts`

Define these exact types:

```typescript
export type Risk = {
  id: string;              // uuid
  command: string;
  reason: string;          // plain-language explanation from Gemini
  source: "regex" | "risks_md";
};

export type VerifierResponse =
  | { status: "VALIDATED" }
  | { status: "SINGLE_RISK";    risk: Risk }
  | { status: "MULTIPLE_RISKS"; risks: Risk[] };

export type PendingRequest = {
  resolve:  (approvedCommands: string[]) => void;
  reject:   (reason: string) => void;
  commands: string[];
  trace:    string;
};

export type OverridePayload = {
  id:              string;
  approvedRiskIds: string[];   // ["*"] = all approved, [] = all denied, subset = selective
};
```

### `src/gateway.ts`

Implement the MCP gateway with this exact logic:

- Expose an MCP tool called `execute_terminal_command` with parameters:
  - `commands`: `string | string[]` — one or more shell commands
  - `trace`: `string` — Copilot's reasoning for why it wants to run these commands

- When the tool is called:
  1. Generate a UUID request ID.
  2. Store `{ resolve, reject, commands, trace }` in a `Map<string, PendingRequest>` called `pending`.
  3. Call the Verifier API at `POST http://localhost:8000/verify` with `{ id, commands, trace }`.
  4. Set a 15-second timeout: if no verifier response, call `reject("Verification timed out — action blocked.")` and delete from `pending`.
  5. Await the Promise. On resolve, run each approved command locally with `child_process.exec` and return combined stdout.
  6. On reject, throw an MCP error with the rejection reason.

- Expose a local HTTP server on port **8001** with two POST endpoints:
  - `POST /sentinel/verify-result` — called by the Verifier API with a `VerifierResponse & { id: string }`.
    - `VALIDATED`: resolve with all commands.
    - `SINGLE_RISK`: call `promptUserSingle(id, risk)` and leave Promise pending.
    - `MULTIPLE_RISKS`: call `promptUserChecklist(id, risks)` and leave Promise pending.
  - `POST /sentinel/override` — called by the terminal prompter with `OverridePayload`.
    - `approvedRiskIds === ["*"]`: resolve with all commands.
    - `approvedRiskIds === []`: reject with "All actions denied by security policy."
    - Subset: resolve with only the commands mapped to approved risk IDs. Use a `Map<string, string>` called `riskIdToCommand` keyed as `"requestId:riskId"` → command string. Clean up both maps after resolution.

### `src/prompter.ts`

Implement two terminal prompting functions using Node.js `readline`:

**`promptUserSingle(id, risk)`**
Print to stderr:
```
⚠  RISK DETECTED
   Command : <command>
   Reason  : <reason>
   Source  : <source>

   Proceed? (y/n):
```
On `y`: POST to `http://localhost:8001/sentinel/override` with `{ id, approvedRiskIds: ["*"] }`.
On `n`: POST with `{ id, approvedRiskIds: [] }`.

**`promptUserChecklist(id, risks)`**
Print to stderr:
```
⚠  N RISKS DETECTED — select which to allow:

   [1] <command>
       <reason> (<source>)

   [2] <command>
       <reason> (<source>)

   Enter numbers to approve (e.g. 1,3) or "none" to deny all:
```
Parse input: `"none"` → `[]`. Numbers → map to `risks[i-1].id` array. POST to override endpoint.

### `package.json` dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "latest",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "latest"
  }
}
```

---

## 2. Verifier API (Python / FastAPI)

### `models.py`

Define all Pydantic models. These are the single source of truth for data shapes across the entire system.

```python
from pydantic import BaseModel, Field
from typing import Literal, Union
from uuid import UUID
from datetime import datetime

# ── Inbound from MCP gateway ──────────────────────────────────────

class VerifyRequest(BaseModel):
    id: str                          # UUID from gateway
    commands: list[str]
    trace: str                       # Copilot reasoning

# ── Risk item ────────────────────────────────────────────────────

class Risk(BaseModel):
    id: str                          # UUID, stable identifier per risk
    command: str
    reason: str                      # plain-language Gemini explanation
    source: Literal["regex", "risks_md"]

# ── Outbound to MCP gateway ───────────────────────────────────────

class ValidatedResponse(BaseModel):
    status: Literal["VALIDATED"]
    id: str

class SingleRiskResponse(BaseModel):
    status: Literal["SINGLE_RISK"]
    id: str
    risk: Risk

class MultipleRisksResponse(BaseModel):
    status: Literal["MULTIPLE_RISKS"]
    id: str
    risks: list[Risk]

VerifierResponse = Union[ValidatedResponse, SingleRiskResponse, MultipleRisksResponse]

# ── Dashboard event (structured output) ──────────────────────────
# Emitted to stdout as newline-delimited JSON (one object per line).
# Dashboard consumes this stream directly.

class DashboardEvent(BaseModel):
    event_id: str                    # UUID
    request_id: str                  # links back to the gateway request
    timestamp: datetime
    event_type: Literal[
        "risk_detected",             # emitted per risk found
        "human_approved",            # emitted when human allows action
        "human_denied",              # emitted when human blocks action
        "executed",                  # emitted when command runs
        "timeout",                   # emitted when verifier times out
    ]
    command: str
    risk: Risk | None = None         # populated for risk_detected events
    solana_tx: str | None = None     # populated after Solana log
    agent_id: str                    # identifier for the Copilot session
    reasoning_trace: str
```

### `scanner.py`

Implement `scan_commands(commands: list[str]) -> list[Risk]`.

Flag any command matching these patterns (compile as a single regex set):

| Pattern | Reason |
|---|---|
| `rm\s+-rf` | Recursive force delete |
| `chmod\s+[0-7]*7[0-7]*` | World-writable permission |
| `>\s*/etc/` | Overwrite system config |
| `curl.+\| (bash\|sh)` | Pipe remote script to shell |
| `dd\s+if=` | Raw disk write |
| `mkfs` | Filesystem format |
| `:(){ :\|:& };:` | Fork bomb |
| `mv\s+.+\s+/dev/null` | Silent file destruction |
| `sudo\s+` | Privilege escalation |
| `eval\s+` | Dynamic code execution |
| `base64\s+-d.+\|(bash\|sh)` | Obfuscated shell execution |

Return one `Risk` per matched command with `source="regex"`.

### `auditor.py`

Implement `audit_commands(commands: list[str], trace: str) -> list[Risk]`.

- Read `risks.md` from disk (same directory as `auditor.py`).
- Call the Gemini API (`gemini-1.5-flash`) with this exact system prompt structure:

```
You are a security auditor for an AI coding agent. You will be given:
1. A governance policy document (risks.md)
2. A list of shell commands the agent wants to execute
3. The agent's stated reasoning

Your task: identify any commands that violate the policies defined in risks.md.

Respond ONLY with valid JSON. No markdown, no explanation outside the JSON.

Schema:
{
  "violations": [
    {
      "command": "<exact command string>",
      "reason": "<one sentence: which policy was violated and why>",
      "policy_excerpt": "<the relevant line or section from risks.md>"
    }
  ]
}

If no violations, respond with: {"violations": []}
```

User message:
```
POLICY DOCUMENT:
<contents of risks.md>

COMMANDS TO AUDIT:
<numbered list of commands>

AGENT REASONING:
<trace>
```

- Parse the JSON response. Map each violation to a `Risk` with `source="risks_md"`.
- If Gemini is unavailable or returns unparseable JSON, log the error and return `[]` (fail open for the auditor; regex scan is the hard gate).

### `logger.py`

Implement `log_to_solana(event: DashboardEvent) -> str` returning a transaction signature string.

- Use `solders` and `solana-py` libraries.
- Connect to Solana **devnet** (`https://api.devnet.solana.com`).
- Load or generate a keypair from `SOLANA_KEYPAIR_PATH` env var (default: `~/.config/solana/id.json`). If the file does not exist, generate a new keypair, save it, and airdrop 1 SOL from devnet faucet.
- Build a transaction with a single `Memo` instruction containing this JSON payload (truncated to 566 bytes max — Solana memo limit):

```python
memo_payload = {
    "sentinel": "1.0",
    "req":      event.request_id[:8],    # abbreviated
    "type":     event.event_type,
    "cmd_hash": sha256(event.command.encode()).hexdigest()[:16],
    "risk_id":  event.risk.id[:8] if event.risk else None,
    "ts":       event.timestamp.isoformat(),
}
```

- Send the transaction, confirm with `confirmed` commitment.
- Return the transaction signature.
- On any Solana error: log the error, return `"solana_unavailable"` — never block the main flow.

### `main.py`

Implement the FastAPI app with one endpoint:

**`POST /verify`** — receives `VerifyRequest`, returns `VerifierResponse`

Logic:
1. Run `scan_commands` and `audit_commands` concurrently using `asyncio.gather`.
2. Deduplicate risks by command string (regex takes priority over risks_md for the same command).
3. Determine response:
   - 0 risks → `ValidatedResponse`
   - 1 risk → `SingleRiskResponse`
   - 2+ risks → `MultipleRisksResponse`
4. For each risk found:
   - Emit a `DashboardEvent` with `event_type="risk_detected"` to stdout as newline-delimited JSON.
   - Call `log_to_solana` with the event; update `solana_tx` field before emitting.
5. POST the `VerifierResponse` back to the MCP gateway at `http://localhost:8001/sentinel/verify-result`.
6. Return the `VerifierResponse` as the HTTP response body.

Add a second endpoint:

**`POST /execution-result`** — receives `{ request_id, command, approved, agent_id, trace }`

- Emit a `DashboardEvent` with `event_type="human_approved"` or `"human_denied"`.
- Log to Solana.
- Emit to stdout.

---

## 3. `risks.md` — default governance policy

Populate with these example policies that Gemini will reason against:

```markdown
# SentinelAI Governance Policy

## Protected paths
- Do not modify /etc, /usr, /bin, /sbin, or /boot without explicit lead approval.
- Do not delete files outside the current project working directory.

## Authentication
- Do not modify any file in /auth, /login, or /oauth paths without lead approval.
- Do not change environment variables related to secrets, tokens, or API keys.

## Network
- Do not open new listening ports without approval.
- Do not make outbound requests to IP addresses outside known domains.

## Data
- Do not access, copy, or transmit files matching *.pem, *.key, *.env, id_rsa.
- Do not run database migrations on production connection strings.

## Destructive operations
- Never run commands that delete, overwrite, or truncate data without a prior backup step.
- Never pipe remote content directly into a shell interpreter.
```

---

## 4. Dashboard JSON contract

The dashboard consumes newline-delimited JSON from the verifier's stdout. Each line is one `DashboardEvent`. This is the full schema the dashboard must support:

```json
{
  "event_id":        "uuid-v4",
  "request_id":      "uuid-v4",
  "timestamp":       "2024-01-15T10:30:00.123Z",
  "event_type":      "risk_detected | human_approved | human_denied | executed | timeout",
  "command":         "rm -rf /tmp/build",
  "risk": {
    "id":      "uuid-v4",
    "command": "rm -rf /tmp/build",
    "reason":  "Recursive force delete in a path outside the project directory",
    "source":  "regex"
  },
  "solana_tx":       "5KtPn1...transaction_signature",
  "agent_id":        "copilot-session-abc123",
  "reasoning_trace": "I need to clean the build directory before recompiling"
}
```

`risk` is `null` for `human_approved`, `human_denied`, `executed`, and `timeout` events.
`solana_tx` is `null` for `executed` events where no risk was detected.

---

## 5. Environment variables

The following env vars must be read at startup with sensible defaults:

| Variable | Default | Used by |
|---|---|---|
| `VERIFIER_PORT` | `8000` | verifier/main.py |
| `GATEWAY_CALLBACK_URL` | `http://localhost:8001/sentinel/verify-result` | verifier/main.py |
| `GEMINI_API_KEY` | required | verifier/auditor.py |
| `SOLANA_KEYPAIR_PATH` | `~/.config/solana/id.json` | verifier/logger.py |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | verifier/logger.py |
| `RISKS_MD_PATH` | `./risks.md` | verifier/auditor.py |
| `AGENT_ID` | `copilot-default` | verifier/main.py |

---

## 6. `requirements.txt`

```
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
pydantic>=2.0.0
httpx>=0.27.0
google-generativeai>=0.5.0
solana>=0.34.0
solders>=0.21.0
python-dotenv>=1.0.0
```

---

## 7. Build and run instructions

Generate a `README.md` with:

```bash
# Terminal 1 — MCP gateway
cd mcp-gateway
npm install
npm run build
node dist/index.js

# Terminal 2 — Verifier API
cd verifier
pip install -r requirements.txt
uvicorn main:app --port 8000

# VS Code — connect Copilot to MCP
# Add to .vscode/mcp.json:
{
  "servers": {
    "sentinelai": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp-gateway/dist/index.js"]
    }
  }
}
```

---

## 8. Constraints and failure modes

- **Fail safe**: if the verifier is unreachable, the gateway must deny the action, never allow it.
- **Timeout**: 15 seconds from tool call to verifier response. After timeout, deny and emit a `timeout` DashboardEvent.
- **Solana errors**: never block the main flow. Log error to stderr and continue with `solana_tx: null`.
- **Gemini errors**: if the API is down or returns malformed JSON, treat as zero Gemini violations (regex scan still runs as the hard gate).
- **Partial approval**: when a subset of commands is approved in the multiple-risks path, only execute the approved subset. Log each denied command as a separate `human_denied` DashboardEvent.
- **Deduplication**: if regex and Gemini both flag the same command, surface only one risk (regex takes priority, set `source: "regex"`).
- **Concurrent risk detection**: run regex scan and Gemini audit in parallel. Do not await one before starting the other.
