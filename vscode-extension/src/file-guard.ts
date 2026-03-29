import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { checkIntent } from "./verifier-client.js";

export function registerFileGuard(context: vscode.ExtensionContext): void {
  const disposable = vscode.workspace.onWillSaveTextDocument((event) => {
    const id = uuidv4();
    const relativePath = vscode.workspace.asRelativePath(event.document.uri);
    const lineCount = event.document.lineCount;
    const reason = event.reason === vscode.TextDocumentSaveReason.Manual
      ? "manual"
      : event.reason === vscode.TextDocumentSaveReason.AfterDelay
      ? "auto-save"
      : "focus-change";

    const prompt = `Save file: ${relativePath} — ${lineCount} lines, reason: ${reason}`;

    const checkPromise = checkIntent(id, prompt).then(
      (response) => {
        if (response.status === "BLOCKED") {
          const firstViolation = response.violations[0];
          const message = firstViolation
            ? `SentinelAI blocked file save: ${firstViolation.reason}`
            : "SentinelAI blocked file save: policy violation";
          vscode.window.showErrorMessage(message);
          return Promise.reject(new Error(message));
        }
      },
      (err: unknown) => {
        const message = `SentinelAI: verifier unreachable — file save blocked. ${err instanceof Error ? err.message : String(err)}`;
        vscode.window.showErrorMessage(message);
        return Promise.reject(new Error(message));
      }
    );

    event.waitUntil(checkPromise);
  });

  context.subscriptions.push(disposable);
}
