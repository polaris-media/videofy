import {
  cameraMovementsEnum,
  moodEnum,
  textPlacementEnum,
} from "./constants.types";
import { z } from "zod";

const locationSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  stillTime: z.number().optional(),
  zoomStart: z.number().optional(),
  zoomEnd: z.number().optional(),
  rotation: z.number().optional(),
});

export const mapDetailLevelEnum = z.enum(["overview", "standard", "close"]);

export const videoAssetSchema = z.object({
  id: z.string(),
  assetType: z.enum(["audio", "video"]).optional(),
  displays: z.number().optional(),
  duration: z.number().optional(),
  title: z.string(),
  streamUrls: z.object({
    hls: z.string().url().nullable().optional(),
    hds: z.string().url().nullable().optional(),
    mp4: z.string().url().nullable().optional(),
    pseudostreaming: z.array(z.string().url()).optional().nullable(),
  }),
});

const hotspotSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  x_norm: z.number().optional(),
  y_norm: z.number().optional(),
  width_norm: z.number().optional(),
  height_norm: z.number().optional(),
});

const sizeSchema = z.object({
  width: z.number(),
  height: z.number(),
});

const imageAssetSchema = z.object({
  id: z.string(),
  size: sizeSchema,
});

export const imageSchema = z.object({
  type: z.literal("image"),
  byline: z.string().optional(),
  description: z.string().optional(),
  imageAsset: imageAssetSchema,
  url: z.string().url(),
  hotspot: hotspotSchema.optional(),
});

export type ImageType = z.infer<typeof imageSchema>;

export const videoSchema = z.object({
  type: z.literal("video"),
  changedId: z.string().optional(),
  description: z.string().optional(),
  videoAsset: videoAssetSchema,
  startFrom: z.number().optional(),
  endAt: z.number().optional(),
  byline: z.string().optional(),
  url: z.string().url(),
});

export type VideoType = z.infer<typeof videoSchema>;

export const mapSchema = z.object({
  type: z.literal("map"),
  location: locationSchema,
  label: z.string().optional(),
  showLabel: z.boolean().optional(),
  detailLevel: mapDetailLevelEnum.optional(),
});

export type MapType = z.infer<typeof mapSchema>;

export const textSchema = z.object({
  type: z.string(),
  text: z.string(),
  line_id: z.number(),
});

export const mediaAssetSchema = z.union([imageSchema, videoSchema, mapSchema]);
export type MediaAssetType = z.infer<typeof mediaAssetSchema>;

export const segmentSchema = z.object({
  id: z.number(),
  mood: moodEnum,
  type: z.string(),
  style: textPlacementEnum,
  text: z.string().optional(),
  texts: z.array(textSchema),
  cameraMovement: cameraMovementsEnum,
  images: z.array(mediaAssetSchema).optional(),
  mainMedia: mediaAssetSchema.optional(),
  customAudio: z
    .object({
      src: z.string().optional(),
      length: z.number().optional(),
    })
    .optional(),
});

export const manuscriptSchema = z.object({
  meta: z.object({
    title: z.string(),
    pubdate: z.string().datetime(),
    byline: z.string(),
    articleUrl: z.string().optional(),
    uniqueId: z.string().optional(),
    prompt: z.array(z.any()).optional(),
    generatedSegments: z.array(segmentSchema).optional(),
  }),
  segments: z.array(segmentSchema),
  media: z.array(mediaAssetSchema).optional(),
});

export type ManuscriptType = z.infer<typeof manuscriptSchema>;
