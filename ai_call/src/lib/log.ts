// Logging to stderr with GitHub Actions workflow commands. Never log
// environment variables, request headers or prompts.

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  group(title: string, body: string): void;
}

/** Workflow command data must escape %, CR and LF. */
export function escapeData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

export const actionsLogger: Logger = {
  info: (m) => process.stderr.write(`${m}\n`),
  warn: (m) => process.stderr.write(`::warning::${escapeData(m)}\n`),
  error: (m) => process.stderr.write(`::error::${escapeData(m)}\n`),
  group: (title, body) => process.stderr.write(`::group::${escapeData(title)}\n${body}\n::endgroup::\n`),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {}, group() {} };
