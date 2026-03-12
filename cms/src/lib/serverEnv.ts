import fs from "node:fs";
import path from "node:path";

const ENV_FILE_CANDIDATES = [
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env.local"),
  path.resolve(process.cwd(), "..", ".env"),
];

let cachedEnv: Record<string, string> | null = null;

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadFallbackEnv(): Record<string, string> {
  if (cachedEnv) {
    return cachedEnv;
  }

  const resolved: Record<string, string> = {};

  for (const filePath of ENV_FILE_CANDIDATES) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const contents = fs.readFileSync(filePath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());
      if (!(key in resolved) && value) {
        resolved[key] = value;
      }
    }
  }

  cachedEnv = resolved;
  return resolved;
}

export function getServerEnvVar(name: string): string | undefined {
  const direct = process.env[name]?.trim();
  if (direct) {
    return direct;
  }

  return loadFallbackEnv()[name];
}
