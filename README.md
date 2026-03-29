# Sentinel AI: Runtime Governance for AI You Can Audit

Sentinel AI is a runtime observability and interception layer for AI coding assistants. It intercepts, validates, and audits every AI-generated action in real time, screening prompts and file saves against a customisable governance policy, blocking dangerous commands, and writing every decision immutably to the Solana blockchain.

![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)
![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react&logoColor=fff)
![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=fff)
![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana&logoColor=fff)

---

## Project Link
https://sentinel-ai-sol.vercel.app/

---

## 🏗 Project Structure

```
/
├── verifier/               # Python FastAPI governance service
│   ├── main.py             # API endpoints (check-intent, verify, log)
│   ├── auditor.py          # Gemini-based semantic policy auditing
│   ├── scanner.py          # Regex pattern matching for risky commands
│   ├── logger.py           # Solana on-chain audit logging
│   ├── models.py           # Pydantic data models
│   └── requirements.txt
├── vscode-extension/       # VS Code extension (TypeScript)
│   └── src/
│       ├── extension.ts    # Entry point & activation
│       ├── guardian.ts     # Chat interception & governance logic
│       ├── verifier-client.ts  # HTTP client to verifier API
│       ├── verifier-process.ts # Spawns verifier subprocess
│       └── file-guard.ts   # File save interceptor
├── dashboard/              # Analytics dashboard (FastAPI + HTML)
│   ├── server.py           # Serves blockchain analytics API
│   └── index.html          # Single-page dashboard UI
├── risks/                  # Governance policy documents (Markdown)
│   ├── RISKS.md
│   ├── cryptography.md
│   ├── data-protection.md
│   ├── injection.md
│   ├── secrets.md
│   └── supply-chain.md
├── product-site/           # Marketing site (React + Vite)
├── tests/                  # Test suite
├── check_gemini.py         # Gemini API connectivity check
└── RISKS.md                # Root-level governance policy
```

---

## 🎯 What is Sentinel AI?

Sentinel AI sits between a developer and their AI coding assistant, enforcing a governance policy on every interaction. The system includes:

- **A VS Code extension** that registers `@sentinelai-guard` as a Copilot chat participant and intercepts file saves
- **A dual-layer verifier** combining fast regex scanning with Gemini AI semantic analysis
- **Customisable Markdown policies** read live on every request — no restart required
- **Immutable audit logs** written to Solana devnet via the SPL Memo program
- **A real-time analytics dashboard** visualising risk decisions, trends, and sources from on-chain data

---

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- Node.js 18+
- VS Code 1.99+
- GitHub Copilot extension installed and signed in

---

### 1. Verifier Service (Python)

```bash
cd verifier
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

Copy the example env file and set your Gemini API key:

```bash
cp verifier/.env.example verifier/.env
```

Then edit `verifier/.env` and fill in your keys:

```
GEMINI_API_KEY=your-gemini-api-key-here
SOLANA_KEYPAIR=[your,solana,keypair,bytes]
```

Verify the key works:

```bash
python check_gemini.py
# Expected: Gemini API is working!
```

---

### 2. VS Code Extension (Development Mode)

```bash
cd vscode-extension
npm install
npm run compile
```

> **Important:** Open the `vscode-extension/` subfolder in VS Code, not the repo root, F5 requires the `.vscode/launch.json` in that folder.

```bash
code path/to/sentinel-ai/vscode-extension
```

Press **F5** (or **Run → Start Debugging**). A second VS Code window opens with SentinelAI loaded.

In that Extension Development Host window, open the repo root:

```
File → Open Folder → sentinel-ai/
```

The extension activates automatically and:
- Spawns the Python verifier subprocess
- Shows: `SentinelAI governance is active.`
- Registers `@sentinelai-guard` in the Copilot chat panel

Try it:

```
@sentinelai-guard write a hello world function
```

Every message is screened by the verifier before reaching Copilot.

---

### 3. Install as a VSIX (Production)

```bash
cd vscode-extension
npx vsce package
code --install-extension sentinelai-0.1.0.vsix
```

Or in VS Code: **Extensions → ... → Install from VSIX**.

---

### 4. Analytics Dashboard (Python)

```bash
cd dashboard
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
python server.py
```

Opens on http://localhost:8003

The dashboard reads from the same `verifier/.env` to derive the Solana public key and fetches on-chain governance events to populate its charts.

---

### 5. Product Site (React)

```bash
cd product-site
npm install
npm run dev
```

Opens on http://localhost:5173

---

## 🛡 Features

- **Intent screening:** Every `@sentinelai-guard` message is checked against policy before reaching Copilot — blocked requests never leave the machine.
- **File save protection:** `onWillSaveTextDocument` intercepts saves; files violating policy are cancelled with an inline notification.
- **Dual-layer detection:** Regex patterns catch known dangerous commands instantly; Gemini 2.5 Flash handles nuanced, context-aware violations.
- **Live policy editing:** Update any `.md` file in `risks/` and the change takes effect on the next request — no restart needed.
- **Immutable audit trail:** Every prompt, risk event, and human decision is written to Solana devnet via the SPL Memo program.
- **Real-time dashboard:** Visualises accepted vs rejected decisions, daily risk trends, risk ratio over time, and breakdown by source policy file.

---

## ⚙️ How It Works

```
User types @sentinelai-guard <message>
        │
        ▼
guardian.ts  →  POST /check-intent  →  auditor.py (Gemini + RISKS.md)
        │
        ├── BLOCKED  →  show policy violations in chat, log to Solana
        │
        └── APPROVED →  forward to Copilot gpt-4o, stream response
                              │
                              ▼
                    Copilot suggests shell commands
                              │
                              ▼
                    POST /verify  →  scanner.py (regex) + auditor.py (Gemini)
                              │
                              ├── RISKY  →  prompt user to accept / deny
                              │                    │
                              │              log decision to Solana
                              │
                              └── SAFE   →  execute
```

File saves follow the same `/check-intent` path and are cancelled if a violation is found.

---

## 🔌 Verifier API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/check-intent` | POST | Screens user prompt against governance policy |
| `/verify` | POST | Scans shell commands via regex + Gemini |
| `/execution-result` | POST | Records human approval / denial decisions |
| `/intent-result` | POST | Logs prompt-level decisions |
| `/docs` | GET | Interactive Swagger UI |

---

## 📋 Customising the Policy

Edit any `.md` file in the `risks/` directory. The verifier re-reads all policy files on every request — changes are live immediately with no restart required.

---

## 🧪 Troubleshooting

| Problem | Fix |
|---|---|
| `SentinelAI governance is active` never appears | Check the **SentinelAI Verifier** output channel for startup errors |
| `@sentinelai-guard` not in chat | Ensure GitHub Copilot is installed and you are signed in |
| Verifier fails to start | Run `uvicorn main:app --port 8000` from `verifier/` manually to see the error |
| `GEMINI_API_KEY` errors | Run `python check_gemini.py` from the repo root to verify the key |
| Port 8000 already in use | Change `VERIFIER_PORT` in `verifier/.env` and `sentinelai.verifierPort` in VS Code settings |
| Dashboard shows no data | Confirm `SOLANA_KEYPAIR` is set in `verifier/.env` and the verifier has logged at least one event |

---

## 👨‍💻 Authors & Credits

Sentinel AI is maintained by Ahmed Hassan, Pranav Bhagwat, Rameez Malik
