import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { checkIntent } from "./verifier-client.js";

const READ_FILE_TOOL: vscode.LanguageModelChatTool = {
  name: "read_file",
  description: "Read the current content of a file in the workspace.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Workspace-relative path to the file, e.g. 'src/utils/auth.ts'",
      },
    },
    required: ["filePath"],
  },
};

const EDIT_FILE_TOOL: vscode.LanguageModelChatTool = {
  name: "edit_file",
  description:
    "Create or overwrite a file in the workspace with new content. " +
    "If the file already exists, call read_file first to get its current content, then supply the complete updated content here.",
  inputSchema: {
    type: "object",
    properties: {
      filePath: {
        type: "string",
        description: "Workspace-relative path to the file, e.g. 'src/utils/auth.ts'",
      },
      newContent: {
        type: "string",
        description: "The complete new content of the file.",
      },
    },
    required: ["filePath", "newContent"],
  },
};

const TOOLS = [READ_FILE_TOOL, EDIT_FILE_TOOL];
const MAX_TOOL_ITERATIONS = 10;

interface ReadFileInput {
  filePath: string;
}

interface EditFileInput {
  filePath: string;
  newContent: string;
}

async function applyFileEdit(workspaceRoot: vscode.Uri, filePath: string, newContent: string): Promise<void> {
  const uri = vscode.Uri.joinPath(workspaceRoot, filePath);
  const edit = new vscode.WorkspaceEdit();
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
    edit.replace(uri, fullRange, newContent);
  } catch {
    // File does not exist yet — create it
    edit.createFile(uri, { overwrite: true, contents: Buffer.from(newContent, "utf-8") });
  }
  await vscode.workspace.applyEdit(edit);
}

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

  const messages: vscode.LanguageModelChatMessage[] = [
    vscode.LanguageModelChatMessage.User(
      "You are a coding assistant integrated with SentinelAI governance. " +
      "When you need to modify an existing file, first call read_file to get its current content, " +
      "then call edit_file with the complete updated content. " +
      "When creating a new file, call edit_file directly. " +
      "Briefly explain what you are doing before calling any tool."
    ),
  ];

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

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await model.sendRequest(messages, { tools: TOOLS }, token);

    const assistantParts: Array<vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart> = [];
    const toolResults: vscode.LanguageModelToolResultPart[] = [];
    let hasToolCalls = false;

    for await (const chunk of response.stream) {
      if (chunk instanceof vscode.LanguageModelTextPart) {
        stream.markdown(chunk.value);
        assistantParts.push(chunk);
      } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
        hasToolCalls = true;
        assistantParts.push(chunk);

        let resultText: string;

        if (chunk.name === "read_file" && workspaceRoot) {
          const input = chunk.input as ReadFileInput;
          const uri = vscode.Uri.joinPath(workspaceRoot, input.filePath);
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            resultText = doc.getText();
          } catch {
            resultText = `Error: '${input.filePath}' does not exist in the workspace`;
          }
        } else if (chunk.name === "edit_file" && workspaceRoot) {
          const input = chunk.input as EditFileInput;
          stream.progress(`Applying edit to ${input.filePath}…`);
          await applyFileEdit(workspaceRoot, input.filePath, input.newContent);
          stream.markdown(`\n*Applied edit to \`${input.filePath}\`*`);
          resultText = `Successfully edited ${input.filePath}`;
        } else {
          resultText = `Unknown tool: ${chunk.name}`;
        }

        toolResults.push(
          new vscode.LanguageModelToolResultPart(chunk.callId, [
            new vscode.LanguageModelTextPart(resultText),
          ])
        );
      }
    }

    if (!hasToolCalls) {
      break;
    }

    // Feed the tool results back so the model can continue reasoning
    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
    messages.push(vscode.LanguageModelChatMessage.User(toolResults));
  }
}
