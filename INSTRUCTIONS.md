# SentinelAI — Running Instructions

## Prerequisites

- Node.js 18+
- Python 3.11+
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

---

## Step 1 — Configure environment

Open `verifier/.env` and replace the placeholder with your real Gemini API key:

```env
GEMINI_API_KEY=AIzaSy...your_actual_key
```

Everything else can be left as-is.

---

## Step 2 — Start the MCP Gateway

Open a terminal and run:

```bash
cd mcp-gateway
npm install
npm run build
node dist/index.js
```

Expected output:
```
[gateway] Local HTTP server listening on port 8001
[gateway] MCP server connected via stdio
```

Keep this terminal open.

---

## Step 3 — Start the Verifier API

Open a second terminal and run:

```bash
cd verifier
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Expected output:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

Keep this terminal open.

---

## Step 4 — Connect Copilot to SentinelAI

Create the file `.vscode/mcp.json` in your project root (if it doesn't exist):

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

Then in VS Code:
1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run **"MCP: List Servers"**
3. Confirm `sentinelai` appears as connected

---

## Step 5 — Test the pipeline

There are two ways to test SentinelAI. They exercise different parts of the stack.

---

### Option A — Copilot Agent via MCP Gateway (full pipeline)

This is the intended production path. Commands flow from Copilot → MCP gateway → verifier. The gateway intercepts risky commands and prompts for human approval before anything is executed.

1. Open **GitHub Copilot Chat** (`Ctrl+Alt+I`)
2. Switch to **Agent mode** using the dropdown next to the input box
3. Send a message that asks Copilot to run a command, for example:

   **Safe command:**
   ```
   Use the sentinelai tool to verify this command: echo hello
   ```
   Expected: Copilot calls the MCP tool, verifier returns `VALIDATED`, no prompt appears in the gateway terminal.

   **Risky command:**
   ```
   Use the sentinelai tool to verify this command: rm -rf /tmp/test
   ```
   Expected: Copilot calls the MCP tool, verifier returns `SINGLE_RISK`, and the **gateway terminal** shows:

   ```
   ⚠  RISK DETECTED
      Command : rm -rf /tmp/test
      Reason  : Recursive force delete
      Source  : regex

      Proceed? (y/n):
   ```

   Switch to the gateway terminal and type `y` to approve or `n` to deny. Copilot receives the result and continues.

---

### Option B — curl direct to verifier (bypass gateway, for debugging)

This calls the verifier API directly, skipping the MCP gateway and the human-approval step entirely. Use this to confirm the verifier is running and classifying commands correctly, independent of Copilot or the gateway.

```bash
# Safe command — should return VALIDATED
curl -X POST http://localhost:8000/verify \
  -H "Content-Type: application/json" \
  -d '{"id":"test-001","commands":["echo hello"],"trace":"just printing hello"}'

# Risky command — should return SINGLE_RISK (no terminal prompt — gateway is bypassed)
curl -X POST http://localhost:8000/verify \
  -H "Content-Type: application/json" \
  -d '{"id":"test-002","commands":["rm -rf /tmp/test"],"trace":"cleaning temp files"}'
```

Note: with curl you will see the risk JSON response, but **no approval prompt** appears because the gateway is not in the path.

---

## Step 6 — Watch dashboard events (optional)

To see structured JSON events as they stream out, pipe the verifier through `jq`:

```bash
cd verifier
uvicorn main:app --port 8000 2>/dev/null | jq .
```

Each approved/denied/detected action emits one line of JSON, for example:

```json
{
  "event_id": "uuid",
  "request_id": "uuid",
  "timestamp": "2024-01-15T10:30:00.123Z",
  "event_type": "risk_detected",
  "command": "rm -rf /tmp/test",
  "risk": {
    "id": "uuid",
    "command": "rm -rf /tmp/test",
    "reason": "Recursive force delete",
    "source": "regex"
  },
  "solana_tx": "5KtPn1...",
  "agent_id": "copilot-default",
  "reasoning_trace": "cleaning temp files"
}
```

---

## Solana devnet

No setup needed. On first run, if no keypair exists at `~/.config/solana/id.json`, the logger will:
1. Auto-generate a new keypair and save it
2. Request a 1 SOL airdrop from the devnet faucet

All risk events are logged as Memo transactions on Solana devnet. Solana errors never block the main flow.

---

## Stopping the app

Press `Ctrl+C` in each terminal to stop the gateway and verifier.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `GEMINI_API_KEY not set` | Check `verifier/.env` has your real key |
| Gateway says `Verifier unreachable` | Make sure the verifier is running on port 8000 |
| `npm run build` fails | Run `npm install` first inside `mcp-gateway/` |
| `ModuleNotFoundError` in Python | Run `pip install -r requirements.txt` inside `verifier/` |
| Copilot not using SentinelAI | Verify `.vscode/mcp.json` exists and reload VS Code |
| curl returns risk but no approval prompt | Expected — curl bypasses the gateway; use Copilot agent for the full pipeline |
