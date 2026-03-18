"use server";

import type {
  Config,
  ManuscriptType,
  MediaAssetType,
  ProcessedManuscript,
} from "@videofy/types";
import { processedManuscriptSchema } from "@videofy/types";
import { createJob, getJob } from "@/lib/jobsApi";
import {
  importRemoteVideoToProject,
  isProjectVideoUrl,
} from "@/lib/importRemoteVideo";
import { randomId } from "@/lib/randomId";

const FALLBACK_IMAGE_SIZE = {
  width: 1080,
  height: 1080,
};
const PROCESS_TIMEOUT_MS = 180_000;
const JOB_POLL_INTERVAL_MS = 1_000;

const parsePronunciationText = (text: string): [string, string] => {
  const displayText = text.replace(/\s*\[[^\]]+\]/g, "");
  const ttsText = text.replace(/([\p{L}0-9_-]+)\s*\[([^\]]+)\]/gu, "$2");
  return [displayText, ttsText];
};

type BackendMedia = {
  type: "image" | "video" | "map";
  path?: string;
  url?: string;
  byline?: string | null;
  description?: string | null;
  displayMode?: "cover" | "contain-blur" | null;
  location?: {
    lat: number;
    lon: number;
    stillTime?: number | null;
    zoomStart?: number | null;
    zoomEnd?: number | null;
    rotation?: number | null;
  } | null;
  label?: string | null;
  showLabel?: boolean | null;
  detailLevel?: "overview" | "standard" | "close" | null;
  hotspot?: {
    x: number;
    y: number;
    width: number;
    height: number;
    x_norm?: number;
    y_norm?: number;
    width_norm?: number;
    height_norm?: number;
  } | null;
  imageAsset?: {
    id: string;
    size: { width: number; height: number };
  } | null;
  videoAsset?: {
    id: string;
    title: string;
    streamUrls: {
      hls?: string | null;
      hds?: string | null;
      mp4?: string | null;
      pseudostreaming?: string[] | null;
    };
    assetType?: "audio" | "video" | null;
    displays?: number | null;
    duration?: number | null;
  } | null;
  changedId?: string | null;
  start_from?: number | null;
  end_at?: number | null;
};

type BackendSegment = {
  id: number;
  mood: string;
  style: string;
  cameraMovement: string;
  durationOverrideSeconds?: number;
  customAudio?: {
    src?: string;
    length?: number;
  };
  start?: number;
  end?: number;
  texts: Array<{
    type: "text";
    text: string;
    line_id: number;
    who?: string;
    start?: number;
    end?: number;
  }>;
  images?: BackendMedia[];
};

type BackendManuscript = {
  project_id: string;
  meta: {
    title: string;
    byline: string;
    pubdate: string;
    id: number;
    uniqueId: string;
    audio: { src?: string };
  };
  segments: BackendSegment[];
  media?: BackendMedia[];
};

function toDefinedString(value: string | null | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toDefinedNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeHotspot(
  hotspot:
    | {
        x: number;
        y: number;
        width: number;
        height: number;
        x_norm?: number;
        y_norm?: number;
        width_norm?: number;
        height_norm?: number;
      }
    | null
    | undefined
) {
  if (!hotspot) {
    return undefined;
  }

  return {
    x: hotspot.x,
    y: hotspot.y,
    width: hotspot.width,
    height: hotspot.height,
    x_norm: toDefinedNumber(hotspot.x_norm),
    y_norm: toDefinedNumber(hotspot.y_norm),
    width_norm: toDefinedNumber(hotspot.width_norm),
    height_norm: toDefinedNumber(hotspot.height_norm),
  };
}

function buildVideoAsset(
  media: BackendMedia,
  fallback: {
    id: string;
    title: string;
    streamUrls: {
      hls?: string | null;
      hds?: string | null;
      mp4?: string | null;
      pseudostreaming?: string[] | null;
    };
  }
) {
  const sourceVideoAsset = media.videoAsset;
  if (!sourceVideoAsset) {
    return fallback;
  }

  const id = toDefinedString(sourceVideoAsset.id) || fallback.id;
  const title = toDefinedString(sourceVideoAsset.title) || fallback.title;

  const streamUrls = {
    hls: sourceVideoAsset.streamUrls?.hls ?? fallback.streamUrls.hls ?? null,
    hds: sourceVideoAsset.streamUrls?.hds ?? fallback.streamUrls.hds ?? null,
    mp4: sourceVideoAsset.streamUrls?.mp4 ?? fallback.streamUrls.mp4 ?? null,
    pseudostreaming: Array.isArray(sourceVideoAsset.streamUrls?.pseudostreaming)
      ? sourceVideoAsset.streamUrls.pseudostreaming.filter(
          (item): item is string => typeof item === "string"
        )
      : sourceVideoAsset.streamUrls?.pseudostreaming ?? fallback.streamUrls.pseudostreaming ?? null,
  };

  const mergedVideoAsset: {
    id: string;
    title: string;
    streamUrls: {
      hls: string | null;
      hds: string | null;
      mp4: string | null;
      pseudostreaming: string[] | null;
    };
    assetType?: "audio" | "video";
    displays?: number;
    duration?: number;
  } = {
    id,
    title,
    streamUrls,
  };

  if (sourceVideoAsset.assetType === "audio" || sourceVideoAsset.assetType === "video") {
    mergedVideoAsset.assetType = sourceVideoAsset.assetType;
  }

  const displays = toDefinedNumber(sourceVideoAsset.displays);
  if (displays !== undefined) {
    mergedVideoAsset.displays = displays;
  }

  const duration = toDefinedNumber(sourceVideoAsset.duration);
  if (duration !== undefined) {
    mergedVideoAsset.duration = duration;
  }

  return mergedVideoAsset;
}

function resolveProjectRelativePath(projectId: string, media: MediaAssetType): string | null {
  if (!("url" in media)) {
    return null;
  }

  const assetUrlPrefix = `/projects/${projectId}/files/`;
  if (!media.url.includes(assetUrlPrefix)) {
    return null;
  }

  return media.url.split(assetUrlPrefix).pop() || null;
}

function buildBackendTexts(
  segment: ManuscriptType["segments"][number],
  segmentIndex: number
): BackendSegment["texts"] {
  const linesFromSegmentText = (segment.text || "")
    .split("\n\n")
    .filter((line) => line.trim().length > 0);

  if (linesFromSegmentText.length > 0) {
    return linesFromSegmentText.map((line, lineIndex) => {
      const [, ttsText] = parsePronunciationText(line);
      return {
        type: "text" as const,
        text: ttsText,
        line_id: segmentIndex * 100 + lineIndex + 1,
        who: "default",
      };
    });
  }

  return segment.texts.map((line, lineIndex) => ({
    type: "text" as const,
    text: line.text,
    line_id: line.line_id || segmentIndex * 100 + lineIndex + 1,
    who: "default",
  }));
}

function mapFrontendMediaToBackendMedia(
  media: MediaAssetType,
  projectId: string
): BackendMedia | null {
  if (media.type === "map") {
    return {
      type: "map",
      location: media.location,
      label: media.label,
      showLabel: media.showLabel,
      detailLevel: media.detailLevel,
    };
  }

  const projectRelativePath = resolveProjectRelativePath(projectId, media);
  if (!projectRelativePath) {
    return null;
  }

  if (media.type === "video") {
    return {
      type: "video",
      path: projectRelativePath,
      url: media.url,
      byline: media.byline,
      description: media.description,
      changedId: media.changedId,
      videoAsset: media.videoAsset,
      start_from: media.startFrom,
      end_at: media.endAt,
    };
  }

  return {
    type: "image",
    path: projectRelativePath,
    url: media.url,
    byline: media.byline,
    description: media.description,
    displayMode: media.displayMode,
    hotspot: media.hotspot,
    imageAsset: media.imageAsset,
  };
}

function toBackendManuscript(
  projectId: string,
  manuscript: ManuscriptType
): BackendManuscript {
  return {
    project_id: projectId,
    meta: {
      title: manuscript.meta.title,
      byline: manuscript.meta.byline,
      pubdate: manuscript.meta.pubdate,
      id: 1,
      uniqueId: manuscript.meta.uniqueId || randomId(),
      audio: {},
    },
    segments: manuscript.segments.map((segment, segmentIndex) => {
      const segmentId =
        typeof segment.id === "number" && Number.isInteger(segment.id)
          ? segment.id
          : segmentIndex + 1;
      const texts = buildBackendTexts(segment, segmentIndex);
      const selectedMedia = segment.mainMedia ? [segment.mainMedia] : segment.images || [];
      const backendImages = selectedMedia
        .map((media) => mapFrontendMediaToBackendMedia(media, projectId))
        .filter((media): media is BackendMedia => media !== null);

      return {
        id: segmentId,
        mood: segment.mood,
        style: segment.style,
        cameraMovement: segment.cameraMovement,
        durationOverrideSeconds: segment.durationOverrideSeconds,
        customAudio: segment.customAudio,
        texts,
        images: backendImages,
      };
    }),
    media: (manuscript.media || [])
      .map((media) => mapFrontendMediaToBackendMedia(media, projectId))
      .filter((media): media is BackendMedia => media !== null),
  };
}

async function localizeVideoAsset(
  projectId: string,
  media: MediaAssetType,
  cache: Map<string, MediaAssetType>
): Promise<MediaAssetType> {
  if (media.type !== "video" || isProjectVideoUrl(projectId, media.url)) {
    return media;
  }

  const playableUrl =
    media.videoAsset.streamUrls.mp4 ||
    media.videoAsset.streamUrls.pseudostreaming?.[0] ||
    media.url;

  if (!playableUrl) {
    return media;
  }

  const cacheKey = `${media.videoAsset.id}:${playableUrl}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const imported = await importRemoteVideoToProject({
    projectId,
    assetId: media.videoAsset.id || media.changedId || "video",
    sourceUrl: playableUrl,
  });

  const localizedMedia: MediaAssetType = {
    ...media,
    url: imported.url,
    videoAsset: {
      ...media.videoAsset,
      streamUrls: {
        ...media.videoAsset.streamUrls,
        mp4: imported.url,
      },
    },
  };

  cache.set(cacheKey, localizedMedia);
  return localizedMedia;
}

async function localizeRemoteVideos(
  manuscript: ManuscriptType,
  projectId: string
): Promise<ManuscriptType> {
  const cache = new Map<string, MediaAssetType>();

  const media = manuscript.media
    ? await Promise.all(
        manuscript.media.map((asset) => localizeVideoAsset(projectId, asset, cache))
      )
    : undefined;

  const segments = await Promise.all(
    manuscript.segments.map(async (segment) => {
      const mainMedia = segment.mainMedia
        ? await localizeVideoAsset(projectId, segment.mainMedia, cache)
        : undefined;
      const images = segment.images
        ? await Promise.all(
            segment.images.map((asset) => localizeVideoAsset(projectId, asset, cache))
          )
        : undefined;

      return {
        ...segment,
        mainMedia,
        images,
      };
    })
  );

  return {
    ...manuscript,
    media,
    segments,
  };
}

function mapBackendMediaToProcessedMedia(media: BackendMedia) {
  if (media.type === "map") {
    return {
      type: "map" as const,
      location: {
        lat: media.location?.lat || 0,
        lon: media.location?.lon || 0,
        stillTime: toDefinedNumber(media.location?.stillTime),
        zoomStart: toDefinedNumber(media.location?.zoomStart),
        zoomEnd: toDefinedNumber(media.location?.zoomEnd),
        rotation: toDefinedNumber(media.location?.rotation),
      },
      label: toDefinedString(media.label),
      showLabel: typeof media.showLabel === "boolean" ? media.showLabel : undefined,
      detailLevel:
        media.detailLevel === "overview" ||
        media.detailLevel === "standard" ||
        media.detailLevel === "close"
          ? media.detailLevel
          : undefined,
    };
  }

  if (media.type === "video") {
    const fallbackVideoAsset = {
      id: media.path || randomId(),
      title: media.path || "video",
      streamUrls: {
        mp4: media.url,
      },
    };

    return {
      type: "video" as const,
      url: media.url,
      byline: toDefinedString(media.byline),
      description: toDefinedString(media.description),
      changedId: toDefinedString(media.changedId),
      startFrom: toDefinedNumber(media.start_from),
      endAt: toDefinedNumber(media.end_at),
      videoAsset: buildVideoAsset(media, fallbackVideoAsset),
    };
  }

  return {
    type: "image" as const,
    url: media.url || "",
    byline: toDefinedString(media.byline),
    description: toDefinedString(media.description),
    displayMode:
      media.displayMode === "contain-blur" || media.displayMode === "cover"
        ? media.displayMode
        : undefined,
    hotspot: normalizeHotspot(media.hotspot),
    imageAsset: media.imageAsset || {
      id: media.path || randomId(),
      size: FALLBACK_IMAGE_SIZE,
    },
  };
}

function backendToProcessed(
  backendManuscript: BackendManuscript,
  projectId: string
): ProcessedManuscript {
  const segments = backendManuscript.segments.map((segment) => {
    const mediaAssets = (segment.images || []).map(mapBackendMediaToProcessedMedia);

    return {
      id: segment.id,
      mood: segment.mood as
        | "mellow"
        | "sad"
        | "dramatic"
        | "neutral"
        | "hopeful"
        | "upbeat",
      type: "segment",
      style: segment.style as "top" | "middle" | "bottom",
      durationOverrideSeconds: toDefinedNumber(segment.durationOverrideSeconds),
      customAudio:
        segment.customAudio?.src || segment.customAudio?.length !== undefined
          ? {
              src: toDefinedString(segment.customAudio?.src),
              length: toDefinedNumber(segment.customAudio?.length),
            }
          : undefined,
      cameraMovement: segment.cameraMovement as
        | "none"
        | "pan-left"
        | "pan-right"
        | "pan-up"
        | "pan-down"
        | "zoom-in"
        | "zoom-out"
        | "zoom-rotate-left"
        | "zoom-rotate-right"
        | "zoom-out-rotate-left"
        | "zoom-out-rotate-right",
      texts: segment.texts.map((line) => ({
        type: "text",
        text: line.text,
        displayText: line.text,
        line_id: line.line_id,
        who: line.who || "default",
        start: line.start || 0,
        end: line.end || 0,
      })),
      images: mediaAssets,
      start: segment.start || 0,
      end: segment.end || 0,
    };
  });

  return processedManuscriptSchema.parse({
    meta: {
      title: backendManuscript.meta.title,
      pubdate: backendManuscript.meta.pubdate,
      byline: backendManuscript.meta.byline,
      id: backendManuscript.meta.id,
      uniqueId: backendManuscript.meta.uniqueId,
      description: "",
      audio: backendManuscript.meta.audio || {},
      articleUrl: projectId,
    },
    segments,
    media: Array.isArray(backendManuscript.media)
      ? backendManuscript.media.map((media) => mapBackendMediaToProcessedMedia(media))
      : undefined,
  });
}

interface Args {
  uniqueId: string;
  manuscript: ManuscriptType;
  config: Config;
  abortController?: AbortController;
  projectId: string;
  backendGenerationId?: string;
  audioMode?: "none" | "elevenlabs";
}

export const processManuscript = async ({
  manuscript,
  projectId,
  audioMode = "elevenlabs",
}: Args): Promise<ProcessedManuscript> => {
  const localizedManuscript = await localizeRemoteVideos(manuscript, projectId);
  const backendPayload = toBackendManuscript(projectId, localizedManuscript);
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), PROCESS_TIMEOUT_MS);
  try {
    const job = await createJob({
      kind: "process-manuscript",
      payload: {
        projectId,
        manuscript: backendPayload,
        audioMode,
      },
    });

    while (true) {
      if (abortController.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const snapshot = await getJob<{ processed_json?: BackendManuscript }>(job.jobId);

      if (snapshot.status === "failed") {
        throw new Error(snapshot.error || `Process failed for project ${projectId}`);
      }

      if (snapshot.status === "completed") {
        const payload = snapshot.result;
        if (!payload?.processed_json) {
          console.error(
            `[cms.process] Missing processed_json in job result for project '${projectId}'`
          );
          throw new Error("Backend did not return processed_json");
        }

        return backendToProcessed(payload.processed_json, projectId);
      }

      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Processing manuscript timed out for project ${projectId} after ${PROCESS_TIMEOUT_MS}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};
