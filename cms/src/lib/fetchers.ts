import { spawn, spawnSync } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { getServerEnvVar } from "./serverEnv";

const fieldSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  label: z.string().min(1),
  required: z.boolean(),
  placeholder: z.string().optional(),
});

const optionalFlagSchema = z.object({
  field: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  flag: z.string().regex(/^--[a-z0-9-]+$/),
});

const fetcherSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  order: z.number().int().optional().default(100),
  description: z.string().min(1).optional().default(""),
  script: z.string().min(1).default("fetcher.py"),
  hidden: z.boolean().optional().default(false),
  requiredEnv: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/))
    .optional()
    .default([]),
  fields: z.array(fieldSchema).min(1),
  args: z.array(z.string()).default([]),
  optionalFlags: z.array(optionalFlagSchema).default([]),
});

export type FetcherFieldSpec = z.infer<typeof fieldSchema>;
export type FetcherOptionalFlagSpec = z.infer<typeof optionalFlagSchema>;
export type FetcherSpec = z.infer<typeof fetcherSpecSchema>;

export type PublicFetcherSpec = Pick<
  FetcherSpec,
  "id" | "title" | "order" | "description" | "fields"
>;

export type FetcherRunResult = {
  projectId: string;
  stdout: string;
  stderr: string;
  command: string[];
};

type CommandSpec = {
  command: string;
  args: string[];
};

function repoRoot(): string {
  return resolve(process.cwd(), "..");
}

function fetchersRoot(): string {
  return join(repoRoot(), "fetchers");
}

function assertSafeFetcherId(fetcherId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(fetcherId)) {
    throw new Error("Invalid fetcher id");
  }
  return fetcherId;
}

async function readFetcherSpec(fetcherId: string): Promise<FetcherSpec> {
  const safeId = assertSafeFetcherId(fetcherId);
  const root = fetchersRoot();
  const fetcherDir = resolve(root, safeId);
  if (!fetcherDir.startsWith(resolve(root))) {
    throw new Error("Unsafe fetcher path");
  }

  const specPath = join(fetcherDir, "fetcher.json");
  const raw = await readFile(specPath, "utf-8");
  const parsed = fetcherSpecSchema.parse(JSON.parse(raw));

  if (parsed.id !== safeId) {
    throw new Error(`Fetcher id mismatch in ${specPath}`);
  }
  return parsed;
}

function isMissingFetcherSpec(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    (error as { code: string }).code === "ENOENT"
  );
}

function asPublicFetcher(spec: FetcherSpec): PublicFetcherSpec {
  return {
    id: spec.id,
    title: spec.title,
    order: spec.order,
    description: spec.description,
    fields: spec.fields,
  };
}

function hasRequiredEnvironment(spec: FetcherSpec): boolean {
  return spec.requiredEnv.every((name) => Boolean(getServerEnvVar(name)?.trim()));
}

export async function listFetchers(): Promise<PublicFetcherSpec[]> {
  const root = fetchersRoot();
  const entries = await readdir(root, { withFileTypes: true });

  const specs: PublicFetcherSpec[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const fetcherId = entry.name;
    if (fetcherId.startsWith(".") || fetcherId.startsWith("_")) {
      continue;
    }
    try {
      const spec = await readFetcherSpec(fetcherId);
      if (spec.hidden || !hasRequiredEnvironment(spec)) {
        continue;
      }
      specs.push(asPublicFetcher(spec));
    } catch (error) {
      if (isMissingFetcherSpec(error)) {
        continue;
      }
      console.error(`Skipping invalid fetcher '${fetcherId}':`, error);
    }
  }

  return specs.sort((a, b) => {
    const orderDiff = a.order - b.order;
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return a.title.localeCompare(b.title);
  });
}

function applyPlaceholder(template: string, inputs: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_all, fieldName: string) => {
    const value = (inputs[fieldName] || "").trim();
    if (!value) {
      throw new Error(`Missing value for '${fieldName}'`);
    }
    return value;
  });
}

function parseProjectId(stdout: string, stderr: string): string | null {
  const combined = `${stdout}\n${stderr}`;
  const direct = combined.match(/Created project:\s*([A-Za-z0-9][A-Za-z0-9._-]*)/);
  if (direct?.[1]) {
    return direct[1];
  }
  const fromPath = combined.match(/\/projects\/([A-Za-z0-9][A-Za-z0-9._-]*)/);
  if (fromPath?.[1]) {
    return fromPath[1];
  }
  return null;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      rejectPromise(error);
    });
    child.on("close", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

let cachedUvCommand: CommandSpec | null = null;

function resolveUvCommand(): CommandSpec {
  if (cachedUvCommand) {
    return cachedUvCommand;
  }

  const candidates: CommandSpec[] = [
    { command: "uv", args: [] },
    { command: "python3", args: ["-m", "uv"] },
    { command: "python", args: ["-m", "uv"] },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, [...candidate.args, "--version"], {
      stdio: "ignore",
    });
    if (result.status === 0) {
      cachedUvCommand = candidate;
      return candidate;
    }
  }

  throw new Error("Could not find `uv`. Install uv or make it available on PATH.");
}

export async function runFetcher(
  fetcherId: string,
  inputValues: Record<string, string>
): Promise<FetcherRunResult> {
  const spec = await readFetcherSpec(fetcherId);
  if (!hasRequiredEnvironment(spec)) {
    throw new Error(`Fetcher '${spec.title}' is not available because required credentials are missing`);
  }
  const root = fetchersRoot();
  const fetcherDir = resolve(root, spec.id);
  const scriptPath = resolve(fetcherDir, spec.script || "fetcher.py");
  if (!scriptPath.startsWith(fetcherDir)) {
    throw new Error("Unsafe fetcher script path");
  }
  await access(scriptPath);

  const inputs = Object.fromEntries(
    Object.entries(inputValues).map(([key, value]) => [key, String(value ?? "").trim()])
  );

  for (const field of spec.fields) {
    if (field.required && !inputs[field.name]) {
      throw new Error(`${field.label} is required`);
    }
  }

  const fetcherArgs: string[] = [];
  for (const template of spec.args) {
    fetcherArgs.push(applyPlaceholder(template, inputs));
  }
  for (const optional of spec.optionalFlags) {
    const value = inputs[optional.field];
    if (!value) {
      continue;
    }
    fetcherArgs.push(optional.flag, value);
  }

  // Always replace an existing project directory for repeated imports.
  const uvCommand = resolveUvCommand();
  const command = uvCommand.command;
  const args = [...uvCommand.args, "run", "python", scriptPath, ...fetcherArgs, "--force"];
  const { code, stdout, stderr } = await runCommand(command, args, repoRoot());

  if (code !== 0) {
    const details = (stderr || stdout || "Unknown fetcher error").trim();
    throw new Error(`Fetcher failed (${code}): ${details}`);
  }

  const projectId = parseProjectId(stdout, stderr);
  if (!projectId) {
    throw new Error("Fetcher succeeded, but project id could not be detected from output");
  }

  return {
    projectId,
    stdout,
    stderr,
    command: [command, ...args],
  };
}
