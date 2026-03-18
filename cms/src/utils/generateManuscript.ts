"use server";

import type { Config, ManuscriptType, MediaAssetType } from "@videofy/types";
import { manuscriptSchema } from "@videofy/types";
import sharp from "sharp";
import { prepareManuscript } from "./prepareManuscript";
import { createJob, getJob } from "@/lib/jobsApi";

const FALLBACK_IMAGE_SIZE = { width: 1080, height: 1080 };
const GENERATE_TIMEOUT_MS = 180_000;
const JOB_POLL_INTERVAL_MS = 1_000;

type BackendLine = {
  text: string;
  line_id: number;
};

type BackendMedia = {
  type: "image" | "video";
  path: string;
  url: string;
  byline?: string | null;
  description?: string | null;
  displayMode?: "cover" | "contain-blur" | null;
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
  start_from?: number | null;
  end_at?: number | null;
};

type BackendSegment = {
  id: number;
  mood: string;
  style: string;
  cameraMovement: string;
  durationOverrideSeconds?: number | null;
  texts: BackendLine[];
  images?: BackendMedia[];
};

type BackendManuscript = {
  meta: {
    title: string;
    byline: string;
    pubdate: string;
    uniqueId: string;
  };
  segments: BackendSegment[];
  media?: BackendMedia[];
};

async function readImageSizeFromUrlOrFallback(
  url: string
): Promise<{ width: number; height: number }> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return FALLBACK_IMAGE_SIZE;
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(imageBuffer).metadata();

    return {
      width: metadata.width || FALLBACK_IMAGE_SIZE.width,
      height: metadata.height || FALLBACK_IMAGE_SIZE.height,
    };
  } catch {
    return FALLBACK_IMAGE_SIZE;
  }
}

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

async function mapBackendMediaToFrontendMedia(
  media: BackendMedia
): Promise<MediaAssetType> {
  if (media.type === "video") {
    const fallbackVideoAsset = {
      id: media.path,
      title: media.path,
      streamUrls: {
        mp4: media.url,
      },
    };

    return {
      type: "video",
      url: media.url,
      byline: toDefinedString(media.byline),
      description: toDefinedString(media.description),
      startFrom: toDefinedNumber(media.start_from),
      endAt: toDefinedNumber(media.end_at),
      videoAsset: buildVideoAsset(media, fallbackVideoAsset),
    };
  }

  const imageSize = media.imageAsset?.size || (await readImageSizeFromUrlOrFallback(media.url));
  return {
    type: "image",
    url: media.url,
    byline: toDefinedString(media.byline),
    description: toDefinedString(media.description),
    displayMode:
      media.displayMode === "contain-blur" || media.displayMode === "cover"
        ? media.displayMode
        : undefined,
    hotspot: normalizeHotspot(media.hotspot),
    imageAsset: {
      id: media.imageAsset?.id || media.path,
      size: imageSize,
    },
  };
}

async function mapBackendSegmentToManuscriptSegment(segment: BackendSegment) {
  const mediaAssets = await Promise.all((segment.images || []).map(mapBackendMediaToFrontendMedia));
  const segmentText = segment.texts.map((line) => line.text).join("\n\n");

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
    text: segmentText,
    durationOverrideSeconds: toDefinedNumber(segment.durationOverrideSeconds),
    texts: segment.texts.map((line) => ({
      type: "text",
      text: line.text,
      line_id: line.line_id,
    })),
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
    images: mediaAssets,
    mainMedia: mediaAssets[0],
  };
}

async function buildManuscriptFromBackend(
  backendManuscript: BackendManuscript,
  projectId: string
): Promise<ManuscriptType> {
  const segments = await Promise.all(
    backendManuscript.segments.map((segment) => mapBackendSegmentToManuscriptSegment(segment))
  );
  const media = Array.isArray(backendManuscript.media)
    ? await Promise.all(backendManuscript.media.map((item) => mapBackendMediaToFrontendMedia(item)))
    : undefined;

  const parsedManuscript = manuscriptSchema.parse({
    meta: {
      title: backendManuscript.meta.title,
      byline: backendManuscript.meta.byline,
      pubdate: backendManuscript.meta.pubdate,
      articleUrl: projectId,
      uniqueId: backendManuscript.meta.uniqueId,
    },
    segments,
    media,
  });

  return prepareManuscript(parsedManuscript);
}

export const generateManuscript = async (
  projectId: string,
  config: Config
): Promise<ManuscriptType> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), GENERATE_TIMEOUT_MS);
  try {
    const job = await createJob({
      kind: "generate-manuscript",
      payload: {
        projectId,
      },
    });

    while (true) {
      if (abortController.signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const snapshot = await getJob<{
        manuscript_json?: BackendManuscript;
      }>(job.jobId);

      if (snapshot.status === "failed") {
        throw new Error(snapshot.error || `Generating manuscript failed for project ${projectId}`);
      }

      if (snapshot.status === "completed") {
        const payload = snapshot.result;
        if (!payload?.manuscript_json) {
          console.error(
            `[cms.generate] Missing manuscript_json in job result for project '${projectId}'`
          );
          throw new Error("Backend did not return manuscript_json");
        }

        return buildManuscriptFromBackend(payload.manuscript_json, projectId);
      }

      await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Generating manuscript timed out for project ${projectId} after ${GENERATE_TIMEOUT_MS}ms`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};
