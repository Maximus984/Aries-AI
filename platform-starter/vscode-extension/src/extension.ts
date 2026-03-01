import * as vscode from "vscode";
import axios from "axios";

type AriesGenerateResponse = {
  ok: boolean;
  output: string;
};

const buildPrompt = (mode: "generate" | "explain" | "fix", selected: string): string => {
  if (mode === "generate") {
    return `Generate production-ready code for:\n${selected || "Create a useful starter function."}`;
  }
  if (mode === "explain") {
    return `Explain this code clearly with concise bullets:\n${selected}`;
  }
  return `Fix bugs and improve this code. Return only the updated code:\n${selected}`;
};

const runCommand = async (mode: "generate" | "explain" | "fix") => {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("No active editor.");
    return;
  }

  const config = vscode.workspace.getConfiguration("aries");
  const apiBaseUrl = config.get<string>("apiBaseUrl") ?? "http://localhost:4000";
  const apiKey = config.get<string>("apiKey") ?? "";
  const model = config.get<string>("model") ?? "gpt-4.1-mini";

  if (!apiKey) {
    vscode.window.showErrorMessage("Set aries.apiKey in VS Code settings.");
    return;
  }

  const selection = editor.selection;
  const selectedText = editor.document.getText(selection).trim();
  const prompt = buildPrompt(mode, selectedText);

  try {
    const response = await axios.post<AriesGenerateResponse>(
      `${apiBaseUrl}/api/generate`,
      { prompt, model },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey
        },
        timeout: 45000
      }
    );

    const output = response.data.output?.trim();
    if (!output) {
      vscode.window.showWarningMessage("Aries returned an empty response.");
      return;
    }

    await editor.edit((editBuilder) => {
      if (selection.isEmpty) {
        editBuilder.insert(selection.active, `${output}\n`);
      } else {
        editBuilder.replace(selection, output);
      }
    });
  } catch (error) {
    const message =
      axios.isAxiosError(error)
        ? error.response?.data?.error ?? error.message
        : error instanceof Error
          ? error.message
          : "Unknown extension error";
    vscode.window.showErrorMessage(`Aries request failed: ${message}`);
  }
};

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("aries.generateCode", () => runCommand("generate")),
    vscode.commands.registerCommand("aries.explainCode", () => runCommand("explain")),
    vscode.commands.registerCommand("aries.fixCode", () => runCommand("fix"))
  );
}

export function deactivate() {
  // no-op
}
