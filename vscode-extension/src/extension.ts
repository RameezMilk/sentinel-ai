import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { VerifierProcess } from "./verifier-process.js";
import { handleRequest } from "./guardian.js";

const verifierProcess = new VerifierProcess();
let verifierStarted = false;

function tryStartVerifier(workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined): void {
  if (verifierStarted || !workspaceFolders || workspaceFolders.length === 0) {
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const verifierDir = path.join(workspaceRoot, "verifier");

  if (!fs.existsSync(verifierDir)) {
    // This workspace doesn't have a verifier/ folder — not a sentinel-ai project, stay silent
    return;
  }

  verifierStarted = true;

  verifierProcess.start(verifierDir).then(() => {
    vscode.window.showInformationMessage("SentinelAI governance is active.");
  }).catch((err: unknown) => {
    verifierStarted = false; // allow retry if workspace changes
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `SentinelAI: verifier failed to start — ${msg}. ` +
      `Check the "SentinelAI Verifier" output channel for details.`
    );
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Register chat participant and file guard — they fail closed if verifier is unreachable
  const participant = vscode.chat.createChatParticipant("sentinelai.guard", handleRequest);
  participant.iconPath = new vscode.ThemeIcon("shield");
  context.subscriptions.push(participant);

  // Try immediately if a workspace is already open
  tryStartVerifier(vscode.workspace.workspaceFolders);

  // Also try when the user opens a folder later
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      tryStartVerifier(e.added.length > 0 ? vscode.workspace.workspaceFolders : undefined);
    })
  );
}

export function deactivate(): void {
  verifierProcess.stop();
}
