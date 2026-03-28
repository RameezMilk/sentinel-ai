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

interface FileContext {
  path: string;
  content: string;
}

async function resolveReferences(references: readonly vscode.ChatPromptReference[]): Promise<FileContext[]> {
  const contexts: FileContext[] = [];

  for (const ref of references) {
    let uri: vscode.Uri | undefined;
    let range: vscode.Range | undefined;

    if (ref.value instanceof vscode.Uri) {
      uri = ref.value;
    } else if (ref.value instanceof vscode.Location) {
      uri = ref.value.uri;
      range = ref.value.range;
    }

    if (!uri) {
      continue;
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const content = range ? doc.getText(range) : doc.getText();
      contexts.push({ path: vscode.workspace.asRelativePath(uri), content });
    } catch {
      // Reference points to an unreadable resource — skip silently
    }
  }

  return contexts;
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

  let userOverrodePolicy = false;

  if (intentResponse.status === "BLOCKED") {
    const violationDetail = intentResponse.violations
      .map((v, i) => `${i + 1}. ${v.subject}: ${v.reason}`)
      .join("\n");

    const choice = await vscode.window.showWarningMessage(
      "SentinelAI: Policy violations detected",
      { modal: true, detail: `${violationDetail}\n\nProceed anyway?` },
      "Yes",
      "No",
    );

    if (choice !== "Yes") {
      const violationList = intentResponse.violations
        .map((v) => `- **${v.subject}**: ${v.reason}\n  Policy: ${v.policy_excerpt}`)
        .join("\n\n");
      stream.markdown(
        `**SentinelAI blocked this request**\n\nThe following policy violations were detected:\n\n${violationList}\n\nEdit your request to comply with the project governance policy (RISKS.md).`
      );
      return;
    }

    userOverrodePolicy = true;
  }

  const model = request.model;

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

  // Resolve #-attached files and selections, inject their content before the user prompt
  const fileContexts = await resolveReferences(request.references);
  if (fileContexts.length > 0) {
    const sections = fileContexts
      .map(({ path, content }) => `--- ${path} ---\n${content}`)
      .join("\n\n");
    messages.push(vscode.LanguageModelChatMessage.User(
      `The following files are attached for context:\n\n${sections}`
    ));
  }

  if (userOverrodePolicy) {
    messages.push(vscode.LanguageModelChatMessage.User(
      "The user has reviewed the SentinelAI policy warnings and explicitly chosen to proceed. " +
      "Fulfil the request as asked."
    ));
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

    messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
    messages.push(vscode.LanguageModelChatMessage.User(toolResults));
  }
}
