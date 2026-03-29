# SentinelAI — Setup & Run Instructions

## Prerequisites

- Python 3.11+
- Node.js 18+
- VS Code 1.99+
- GitHub Copilot extension installed and signed in

---

## 1. Set up the Verifier

### Install dependencies

```bash
cd verifier
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

### Configure environment

Edit `verifier/.env` and fill in your Gemini API key:

```
GEMINI_API_KEY=your-gemini-api-key-here
```

All other values have working defaults.

### Test the Gemini API

From the repo root:

```bash
python check_gemini.py
# Expected: Gemini API is working!
```

### Run the verifier manually (optional — for debugging)

The extension starts the verifier automatically on activation. You only need this for standalone testing:

```bash
cd verifier
uvicorn main:app --port 8000
```

The API docs are available at http://localhost:8000/docs.

---

## 2. Set up the VS Code Extension

### Install dependencies

```bash
cd vscode-extension
npm install
```

### Compile

```bash
npm run compile
```

This runs `tsc` and outputs to `vscode-extension/dist/`.

---

## 3. Run the Extension (Development Mode)

> **Important**: You must open the `vscode-extension/` subfolder in VS Code — not the repo root.
> F5 only works when VS Code is opened at the folder that contains `.vscode/launch.json`.

1. Open the extension folder in VS Code:
   ```bash
   code c:/Users/osama/hack/sentinel-ai/vscode-extension
   ```

2. Press **F5** (or go to **Run → Start Debugging**).

   VS Code compiles the extension automatically (via `npm run compile`) then launches an
   **Extension Development Host** — a second VS Code window with SentinelAI loaded.

3. In the Extension Development Host window, open any workspace folder that contains (or will contain) a `verifier/` subdirectory and a `RISKS.md` file — for example, open the repo root:
   ```
   File → Open Folder → sentinel-ai/
   ```

4. The extension activates on startup and:
   - Spawns the Python verifier subprocess automatically
   - Shows: `SentinelAI governance is active.`
   - Registers `@sentinelai-guard` in the Copilot chat panel

5. Open the Copilot chat panel and type:
   ```
   @sentinelai-guard write a hello world function
   ```

   Every message is screened by the verifier before reaching Copilot.

---

## 4. Install as a VSIX (Production)

Package the extension:

```bash
cd vscode-extension
npx vsce package
```

This produces `sentinelai-0.1.0.vsix`. Install it:

```bash
code --install-extension sentinelai-0.1.0.vsix
```

Or in VS Code: **Extensions → ... → Install from VSIX**.

---

## 5. How It Works

```
User types @sentinelai-guard <message>
        │
        ▼
guardian.ts calls POST /check-intent
        │
        ├── BLOCKED → show policy violations in chat, stop here
        │
        └── APPROVED → forward to Copilot gpt-4o, stream response
```

File saves are also intercepted via `onWillSaveTextDocument` and screened by `/check-intent`. Saves that violate policy are cancelled with an error notification.

---

## 6. Verifier API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/check-intent` | POST | Checks user intent against RISKS.md policy |
| `/verify` | POST | Scans shell commands via regex + Gemini |
| `/execution-result` | POST | Records approval/denial decisions |
| `/docs` | GET | Interactive API docs (Swagger UI) |

---

## 7. Customising the Policy

Edit `RISKS.md` in the repo root. The verifier reads it on every request — no restart needed. Add or remove rules to match your project's governance requirements.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `SentinelAI governance is active` never appears | Check the **SentinelAI Verifier** output channel for verifier startup errors |
| `@sentinelai-guard` not available in chat | Ensure GitHub Copilot extension is installed and you are signed in |
| Verifier fails to start | Run `uvicorn main:app --port 8000` from `verifier/` manually to see the error |
| `GEMINI_API_KEY` errors | Run `python check_gemini.py` from the repo root to verify the key |
| Port 8000 already in use | Change `VERIFIER_PORT` in `verifier/.env` and `sentinelai.verifierPort` in VS Code settings |
