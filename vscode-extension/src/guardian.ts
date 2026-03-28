import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { checkIntent } from "./verifier-client.js";

export async function handleRequest(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const id = uuidv4();

  let intentResponse;
  try {
    intentResponse = await checkIntent(id, request.prompt);
  } catch {
    stream.markdown(
      "**SentinelAI: Verifier unreachable**\n\nThis request has been blocked because SentinelAI could not reach the verifier service. Ensure the verifier is running and try again."
    );
    return;
  }

  if (intentResponse.status === "BLOCKED") {
    const violationList = intentResponse.violations
      .map((v) => `- **${v.subject}**: ${v.reason}\n  Policy: ${v.policy_excerpt}`)
      .join("\n\n");

    stream.markdown(
      `**SentinelAI blocked this request**\n\nThe following policy violations were detected:\n\n${violationList}\n\nThis request has not been forwarded to Copilot.\nEdit your request to comply with the project governance policy (RISKS.md).`
    );
    return;
  }

  // status === "APPROVED" — forward to Copilot
  const [model] = await vscode.lm.selectChatModels({ vendor: "copilot", family: "gpt-4o" });
  if (!model) {
    stream.markdown("**SentinelAI**: No Copilot model available. Ensure GitHub Copilot is installed and signed in.");
    return;
  }

  const messages: vscode.LanguageModelChatMessage[] = [];

  for (const turn of context.history) {
    if (turn instanceof vscode.ChatRequestTurn) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    } else if (turn instanceof vscode.ChatResponseTurn) {
      const text = turn.response
        .filter((p) => p instanceof vscode.ChatResponseMarkdownPart)
        .map((p) => (p as vscode.ChatResponseMarkdownPart).value.value)
        .join("");
      if (text) {
        messages.push(vscode.LanguageModelChatMessage.Assistant(text));
      }
    }
  }

  messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

  const response = await model.sendRequest(messages, {}, token);
  for await (const chunk of response.text) {
    stream.markdown(chunk);
  }
}
