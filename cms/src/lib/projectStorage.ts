import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertSafeProjectId(projectId: string): string {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }
  return projectId;
}

class LocalProjectStorage {
  readonly rootPath = join(process.cwd(), "..", "projects");

  resolveProjectPath(projectId: string, ...parts: string[]): string {
    return join(this.rootPath, assertSafeProjectId(projectId), ...parts);
  }

  async ensureProjectDir(projectId: string, ...parts: string[]): Promise<string> {
    const dir = this.resolveProjectPath(projectId, ...parts);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async listProjectIds(): Promise<string[]> {
    await mkdir(this.rootPath, { recursive: true });
    const entries = await readdir(this.rootPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  }

  async readJson<T>(filePath: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  async writeJson<T>(filePath: string, data: T): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async readProjectJson<T>(projectId: string, relativePath: string, fallback: T): Promise<T> {
    return this.readJson(this.resolveProjectPath(projectId, relativePath), fallback);
  }

  async listProjectFiles(projectId: string, relativeDir: string): Promise<string[]> {
    const absoluteDir = this.resolveProjectPath(projectId, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => `${relativeDir}/${entry.name}`);
  }

  async deleteProjectFile(projectId: string, relativePath: string): Promise<boolean> {
    try {
      await unlink(this.resolveProjectPath(projectId, relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async deleteProjectTree(projectId: string): Promise<void> {
    await rm(this.resolveProjectPath(projectId), { recursive: true, force: true });
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async writeProjectFileFromStream(
    projectId: string,
    relativePath: string,
    stream: ReadableStream<Uint8Array>
  ): Promise<string> {
    const parts = relativePath.split("/").filter(Boolean);
    const fileName = parts.pop();
    if (!fileName) {
      throw new Error("Relative project path must include a file name");
    }

    const targetDir = await this.ensureProjectDir(projectId, ...parts);
    const targetPath = join(targetDir, fileName);
    await pipeline(
      Readable.fromWeb(stream as unknown as import("node:stream/web").ReadableStream),
      createWriteStream(targetPath)
    );
    return targetPath;
  }
}

let storageInstance: LocalProjectStorage | null = null;

export function getProjectStorage(): LocalProjectStorage {
  if (!storageInstance) {
    storageInstance = new LocalProjectStorage();
  }
  return storageInstance;
}
