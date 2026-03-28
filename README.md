# SentinelAI

A runtime governance layer that intercepts GitHub Copilot (VS Code extension) tool calls via an MCP server, routes them through a Python Verifier API for risk analysis, logs all risk events immutably to Solana devnet, and emits structured JSON events for downstream dashboard consumption.

## Architecture

```
GitHub Copilot
     │ MCP tool call (execute_terminal_command)
     ▼
mcp-gateway (TypeScript, port 8001)
     │ POST /verify
     ▼
verifier (Python/FastAPI, port 8000)
     ├── scanner.py  ── regex hard-gate
     ├── auditor.py  ── Gemini policy audit
     └── logger.py   ── Solana devnet memo tx
     │ POST /sentinel/verify-result
     ▼
mcp-gateway
     │ terminal prompt (y/n or checklist)
     ▼
POST /sentinel/override  ──▶  execute approved commands
```

## Setup

### Prerequisites

- Node.js 18+
- Python 3.11+
- A Gemini API key
- (Optional) Solana CLI keypair at `~/.config/solana/id.json`

### Environment variables

Create `verifier/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
AGENT_ID=copilot-default
VERIFIER_PORT=8000
GATEWAY_CALLBACK_URL=http://localhost:8001/sentinel/verify-result
SOLANA_KEYPAIR_PATH=~/.config/solana/id.json
SOLANA_RPC_URL=https://api.devnet.solana.com
RISKS_MD_PATH=./risks.md
```

## Running

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
```

## VS Code — connect Copilot to MCP

Add to `.vscode/mcp.json`:

```json
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

## Dashboard JSON contract

The verifier emits newline-delimited JSON to stdout. Each line is one `DashboardEvent`:

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

## Governance policy

Edit `verifier/risks.md` to customize the policies that Gemini audits against. The regex scanner in `verifier/scanner.py` is a separate hard-gate that always runs regardless of Gemini availability.

## Failure modes

| Scenario | Behavior |
|---|---|
| Verifier unreachable | Gateway denies action (fail safe) |
| 15s timeout | Gateway denies action, emits `timeout` event |
| Gemini unavailable | Treat as zero Gemini violations; regex scan still runs |
| Solana error | Log to stderr, continue with `solana_tx: null` |
| Partial approval | Only approved subset of commands executes |
