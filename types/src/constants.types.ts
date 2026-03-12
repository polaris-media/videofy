import { z } from "zod";

export const cameraMovementsEnum = z.enum([
  "none",
  "pan-left",
  "pan-right",
  "pan-up",
  "pan-down",
  "zoom-in",
  "zoom-out",
  "zoom-rotate-left",
  "zoom-rotate-right",
  "zoom-out-rotate-left",
  "zoom-out-rotate-right",
]);

export type CameraMovement = z.infer<typeof cameraMovementsEnum>;

export const cameraMovementsSchema = z.object({
  id: cameraMovementsEnum,
  name: z.string(),
});

export const moodEnum = z.enum([
  "sad",
  "mellow",
  "dramatic",
  "neutral",
  "hopeful",
  "upbeat",
]);

export type Mood = z.infer<typeof moodEnum>;

export const moodSchema = z.object({
  id: moodEnum,
  name: z.string(),
});

export const textPlacementEnum = z.enum(["bottom", "middle", "top"]);

export type TextPlacement = z.infer<typeof textPlacementEnum>;

export const textPlacementSchema = z.object({
  id: textPlacementEnum,
  name: z.string(),
  icon: z.string(),
});
