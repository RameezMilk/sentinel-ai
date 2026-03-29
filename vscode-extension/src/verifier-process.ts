import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as vscode from "vscode";

export class VerifierProcess {
  private proc: ChildProcess | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("SentinelAI Verifier");
  }

  async start(verifierDir: string): Promise<void> {
    const risksPath = path.join(path.dirname(verifierDir), "risks");

    // Locate uvicorn
    const winPath = path.join(verifierDir, ".venv", "Scripts", "uvicorn");
    const unixPath = path.join(verifierDir, ".venv", "bin", "uvicorn");
    let uvicorn = "uvicorn";
    if (fs.existsSync(winPath + ".exe") || fs.existsSync(winPath)) {
      uvicorn = winPath;
    } else if (fs.existsSync(unixPath)) {
      uvicorn = unixPath;
    }

    this.proc = spawn(uvicorn, ["main:app", "--port", "8000", "--log-level", "warning"], {
      cwd: verifierDir,
      env: { ...process.env, RISKS_DIR: risksPath, LOG_LEVEL: process.env.LOG_LEVEL ?? "INFO" },
    });

    this.proc.stderr?.on("data", (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    this.proc.stdout?.on("data", (data: Buffer) => {
      this.outputChannel.append(data.toString());
    });

    // Poll until ready
    await this.waitUntilReady(15000);
  }

  private waitUntilReady(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        http.get("http://localhost:8000/docs", (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        }).on("error", retry);
      };
      const retry = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error("SentinelAI verifier did not start within 15 seconds"));
          return;
        }
        setTimeout(poll, 500);
      };
      poll();
    });
  }

  stop(): void {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}
