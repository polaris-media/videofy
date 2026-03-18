import type { ManuscriptType, MediaAssetType } from "@videofy/types";

const PROJECT_FILE_PATH_PATTERN =
  /^\/projects\/[A-Za-z0-9][A-Za-z0-9._-]*\/files\/.+/;

type ProjectFileStreamUrls = {
  hls?: string | null;
  hds?: string | null;
  mp4?: string | null;
  pseudostreaming?: string[] | null;
};

function isProjectFilePath(value: string): boolean {
  return PROJECT_FILE_PATH_PATTERN.test(value);
}

function extractProjectFileUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (isProjectFilePath(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (isProjectFilePath(parsed.pathname)) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    const marker = trimmed.indexOf("/projects/");
    if (marker >= 0) {
      const candidate = trimmed.slice(marker);
      const [pathname = ""] = candidate.split(/[?#]/, 1);
      if (isProjectFilePath(pathname)) {
        return candidate;
      }
    }
  }

  return null;
}

export function buildProjectFileUrl(projectId: string, projectRelativePath: string): string {
  return `/projects/${projectId}/files/${projectRelativePath.replace(/^\/+/, "")}`;
}

export function normalizeProjectFileUrl(url: string): string {
  return extractProjectFileUrl(url) || url;
}

export function normalizeProjectFileStreamUrls<T extends ProjectFileStreamUrls>(
  streamUrls: T
): T {
  return {
    ...streamUrls,
    hls:
      typeof streamUrls.hls === "string"
        ? normalizeProjectFileUrl(streamUrls.hls)
        : streamUrls.hls,
    hds:
      typeof streamUrls.hds === "string"
        ? normalizeProjectFileUrl(streamUrls.hds)
        : streamUrls.hds,
    mp4:
      typeof streamUrls.mp4 === "string"
        ? normalizeProjectFileUrl(streamUrls.mp4)
        : streamUrls.mp4,
    pseudostreaming: Array.isArray(streamUrls.pseudostreaming)
      ? streamUrls.pseudostreaming.map((item) => normalizeProjectFileUrl(item))
      : streamUrls.pseudostreaming,
  } as T;
}

export function normalizeMediaAssetProjectFileUrls<T extends MediaAssetType>(media: T): T {
  if (media.type === "video") {
    return {
      ...media,
      url: normalizeProjectFileUrl(media.url),
      videoAsset: media.videoAsset
        ? {
            ...media.videoAsset,
            streamUrls: normalizeProjectFileStreamUrls(media.videoAsset.streamUrls),
          }
        : media.videoAsset,
    } as T;
  }

  if (media.type === "image") {
    return {
      ...media,
      url: normalizeProjectFileUrl(media.url),
    } as T;
  }

  return media;
}

export function normalizeManuscriptProjectFileUrls(manuscript: ManuscriptType): ManuscriptType {
  return {
    ...manuscript,
    media: manuscript.media?.map((media) => normalizeMediaAssetProjectFileUrls(media)),
    segments: manuscript.segments.map((segment) => ({
      ...segment,
      images: segment.images?.map((media) => normalizeMediaAssetProjectFileUrls(media)),
      mainMedia: segment.mainMedia
        ? normalizeMediaAssetProjectFileUrls(segment.mainMedia)
        : undefined,
    })),
  };
}

export function resolveServerProjectFileUrl(url: string, dataApiBaseUrl: string): string {
  const normalizedUrl = normalizeProjectFileUrl(url);
  if (!isProjectFilePath(normalizedUrl)) {
    return url;
  }

  return `${dataApiBaseUrl.replace(/\/$/, "")}${normalizedUrl}`;
}

export function resolveProjectFileUrl(url: string, baseUrl: string): string {
  const normalizedUrl = normalizeProjectFileUrl(url);
  if (!isProjectFilePath(normalizedUrl)) {
    return url;
  }

  return `${baseUrl.replace(/\/$/, "")}${normalizedUrl}`;
}

type JsonLike =
  | string
  | number
  | boolean
  | null
  | JsonLike[]
  | { [key: string]: JsonLike };

export function absolutizeProjectFileUrls<T>(value: T, baseUrl: string): T {
  const visit = (current: JsonLike): JsonLike => {
    if (typeof current === "string") {
      return resolveProjectFileUrl(current, baseUrl);
    }

    if (Array.isArray(current)) {
      return current.map((item) => visit(item));
    }

    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current).map(([key, child]) => {
          if (key === "assetBaseUrl" && child === ".") {
            return [key, baseUrl];
          }

          return [key, visit(child)];
        })
      );
    }

    return current;
  };

  return visit(value as JsonLike) as T;
}
