import { join } from "node:path";
import { getProjectStorage } from "@/lib/projectStorage";

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
  return getProjectStorage().rootPath;
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
  return getProjectStorage().resolveProjectPath(assertSafeProjectId(projectId));
}

export function jobsRoot(): string {
  return join(projectsRoot(), ".jobs");
}

export function jobFilePath(jobId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(jobId)) {
    throw new Error(`Invalid jobId: ${jobId}`);
  }
  return join(jobsRoot(), `${jobId}.json`);
}

export function jobWorkerLockPath(): string {
  return join(jobsRoot(), "worker.lock.json");
}

export function generationManifestPath(projectId: string): string {
  return join(projectDir(projectId), "generation.json");
}

export function cmsGenerationPath(projectId: string): string {
  return join(projectDir(projectId), "working", "cms-generation.json");
}

export function workingManuscriptPath(projectId: string): string {
  return join(projectDir(projectId), "working", "manuscript.json");
}

export function configOverridePath(projectId: string): string {
  return join(projectDir(projectId), "working", "config.override.json");
}

export function aiUsagePath(projectId: string): string {
  return join(projectDir(projectId), "working", "ai-usage.json");
}

export async function listProjectIds(): Promise<string[]> {
  return getProjectStorage().listProjectIds();
}

export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  return getProjectStorage().readJson(filePath, fallback);
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await getProjectStorage().writeJson(filePath, data);
}
