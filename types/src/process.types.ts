import { z } from "zod";
import { cameraMovementsEnum, moodEnum } from "./constants.types";
import {
  mapSchema,
  mediaAssetSchema,
  segmentSchema,
  videoAssetSchema,
} from "./manuscript.types";

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

const imageSchema = z.object({
  type: z.literal("image"),
  byline: z.string().optional(),
  description: z.string().optional(),
  displayMode: z.enum(["cover", "contain-blur"]).optional(),
  imageAsset: imageAssetSchema,
  url: z.string().url(),
  hotspot: hotspotSchema.optional(),
});

const videoSchema = z.object({
  type: z.literal("video"),
  changedId: z.string().optional(),
  description: z.string().optional(),
  videoAsset: videoAssetSchema,
  startFrom: z.number().optional(),
  endAt: z.number().optional(),
  byline: z.string().optional(),
  url: z.string().url(),
});

export const processedManuscriptSchema = z.object({
  meta: z.object({
    title: z.string(),
    pubdate: z.string(),
    byline: z.string(),
    id: z.number(),
    uniqueId: z.string(),
    description: z.string(),
    audio: z.object({ src: z.string().optional() }),
    prompt: z.array(z.any()).optional(),
    generatedSegments: z.array(segmentSchema).optional(),
  }),
  segments: z.array(
    z.object({
      id: z.number(),
      mood: moodEnum,
      type: z.string(),
      style: z.enum(["top", "middle", "bottom"]),
      durationOverrideSeconds: z.number().positive().optional(),
      customAudio: z
        .object({
          src: z.string().optional(),
          length: z.number().optional(),
        })
        .optional(),
      texts: z.array(
        z.object({
          type: z.string(),
          text: z.string(),
          displayText: z.string().optional(),
          line_id: z.number(),
          who: z.string(),
          start: z.number(),
          end: z.number(),
        })
      ),
      cameraMovement: cameraMovementsEnum,
      images: z
        .array(z.union([imageSchema, videoSchema, mapSchema]))
        .optional(),
      start: z.number(),
      end: z.number(),
    })
  ),
  media: z.array(mediaAssetSchema).optional(),
});

export type ProcessedManuscript = z.infer<typeof processedManuscriptSchema>;
