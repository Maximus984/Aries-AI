import { exec } from "node:child_process";

type ExecuteFounderCommandOptions = {
  command: string;
  cwd: string;
  timeoutMs: number;
  allowedPrefixes: string[];
};

export type FounderCommandResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

const getCommandPrefix = (command: string): string => {
  const trimmed = command.trim();
  if (!trimmed) {
    return "";
  }

  const [firstToken] = trimmed.split(/\s+/);
  return firstToken;
};

export const executeFounderCommand = async ({
  command,
  cwd,
  timeoutMs,
  allowedPrefixes
}: ExecuteFounderCommandOptions): Promise<FounderCommandResult> => {
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command is required");
  }

  const prefix = getCommandPrefix(trimmed);
  if (!allowedPrefixes.includes(prefix)) {
    throw new Error(`Command prefix '${prefix}' is not allowed`);
  }

  return await new Promise<FounderCommandResult>((resolve, reject) => {
    exec(
      trimmed,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const rawCode = (error as NodeJS.ErrnoException & { code?: string | number }).code;
          const exitCode = typeof rawCode === "number" ? rawCode : 1;

          resolve({
            command: trimmed,
            stdout: stdout ?? "",
            stderr: (stderr ?? "") || error.message,
            exitCode
          });
          return;
        }

        resolve({
          command: trimmed,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: 0
        });
      }
    );
  });
};
