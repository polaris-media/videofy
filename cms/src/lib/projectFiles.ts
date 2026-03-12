import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type GenerationManifest = {
  projectId: string;
  brandId: string;
  promptPack: string;
  voicePack: string;
  options?: {
    orientationDefault?: "vertical" | "horizontal";
    segmentPauseSeconds?: number;
  };
  createdAt: string;
  updatedAt: string;
};

export function projectsRoot(): string {
  return join(process.cwd(), "..", "projects");
}

function assertSafeProjectId(projectId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectId)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }
  return projectId;
}

export function configRoot(): string {
  return join(process.cwd(), "..", "brands");
}

export function newsroomBrandingPath(): string {
  return join(process.cwd(), "..", "newsroom-branding.json");
}

export function projectDir(projectId: string): string {
  return join(projectsRoot(), assertSafeProjectId(projectId));
}

export function generationManifestPath(projectId: string): string {
  return join(projectDir(projectId), "generation.json");
}

export function cmsGenerationPath(projectId: string): string {
  return join(projectDir(projectId), "working", "cms-generation.json");
}

export function configOverridePath(projectId: string): string {
  return join(projectDir(projectId), "working", "config.override.json");
}

export async function listProjectIds(): Promise<string[]> {
  const root = projectsRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}
