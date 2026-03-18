import { basename, extname, join } from "node:path";
import { rm } from "node:fs/promises";
import { getProjectStorage } from "@/lib/projectStorage";
import { buildProjectFileUrl } from "@/lib/projectFileUrl";

const REMOTE_VIDEO_FETCH_TIMEOUT_MS = 60_000;

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

function buildProjectVideoUrl(projectId: string, fileName: string): string {
  return buildProjectFileUrl(projectId, `input/videos/${fileName}`);
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
  const storage = getProjectStorage();
  const targetDir = await storage.ensureProjectDir(projectId, "input", "videos");

  const response = await fetch(sourceUrl, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(REMOTE_VIDEO_FETCH_TIMEOUT_MS),
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

  if (await storage.fileExists(absolutePath)) {
    await response.body?.cancel();
  } else {
    if (!response.body) {
      throw new Error("Remote video response did not include a readable body");
    }

    try {
      await storage.writeProjectFileFromStream(
        projectId,
        `input/videos/${fileName}`,
        response.body
      );
    } catch (error) {
      await rm(absolutePath, { force: true }).catch(() => undefined);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Timed out while downloading remote video after ${REMOTE_VIDEO_FETCH_TIMEOUT_MS}ms`
        );
      }
      throw error;
    }
  }

  return {
    relativePath: `input/videos/${fileName}`,
    url: buildProjectVideoUrl(projectId, fileName),
  };
}
