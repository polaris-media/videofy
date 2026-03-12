import { access, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { projectDir } from "@/lib/projectFiles";

const DEFAULT_FILE_BASE_URL = "http://127.0.0.1:8001";

function sanitizeAssetId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  return normalized || "video";
}

function inferExtension(sourceUrl: string, contentType: string | null): string {
  const contentTypeLower = contentType?.toLowerCase() || "";
  if (contentTypeLower.includes("mp4")) {
    return ".mp4";
  }

  if (contentTypeLower.includes("quicktime")) {
    return ".mov";
  }

  try {
    const url = new URL(sourceUrl);
    const pathExtension = extname(url.pathname);
    if (pathExtension) {
      return pathExtension.toLowerCase();
    }
  } catch {
    const pathExtension = extname(sourceUrl);
    if (pathExtension) {
      return pathExtension.toLowerCase();
    }
  }

  return ".mp4";
}

function getFileBaseUrl(): string {
  return (process.env.MINIMAL_FILE_BASE_URL || DEFAULT_FILE_BASE_URL).replace(
    /\/$/,
    ""
  );
}

function buildProjectVideoUrl(projectId: string, fileName: string): string {
  return `${getFileBaseUrl()}/projects/${projectId}/files/input/videos/${fileName}`;
}

export function isProjectVideoUrl(projectId: string, url: string): boolean {
  return url.includes(`/projects/${projectId}/files/input/videos/`);
}

export async function importRemoteVideoToProject(params: {
  projectId: string;
  assetId: string;
  sourceUrl: string;
}): Promise<{ relativePath: string; url: string }> {
  const { projectId, assetId, sourceUrl } = params;
  const targetDir = join(projectDir(projectId), "input", "videos");

  await mkdir(targetDir, { recursive: true });

  const response = await fetch(sourceUrl, {
    method: "GET",
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to download video (${response.status}): ${body || response.statusText}`
    );
  }

  const extension = inferExtension(
    sourceUrl,
    response.headers.get("content-type")
  );
  const fileName = `${sanitizeAssetId(assetId || basename(sourceUrl))}${extension}`;
  const absolutePath = join(targetDir, fileName);

  try {
    await access(absolutePath);
  } catch {
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(absolutePath, bytes);
  }

  return {
    relativePath: `input/videos/${fileName}`,
    url: buildProjectVideoUrl(projectId, fileName),
  };
}
