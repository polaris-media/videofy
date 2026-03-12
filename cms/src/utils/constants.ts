import type {
  cameraMovementsSchema,
  moodSchema,
  textPlacementSchema,
} from "@videofy/types";
import type { z } from "zod";

export const moods: Array<z.infer<typeof moodSchema>> = [
  { id: "mellow", name: "Mellow" },
  { id: "sad", name: "Sad" },
  { id: "dramatic", name: "Dramatic" },
  { id: "neutral", name: "Neutral" },
  { id: "hopeful", name: "Hopeful" },
  { id: "upbeat", name: "Upbeat" },
];

export const textPlacements: Array<z.infer<typeof textPlacementSchema>> = [
  { id: "bottom", name: "Bottom", icon: "TextBottom" },
  { id: "middle", name: "Middle", icon: "TextMiddle" },
  { id: "top", name: "Top", icon: "TextTop" },
];

export const cameraMovements: Array<z.infer<typeof cameraMovementsSchema>> = [
  { id: "none", name: "None" },
  { id: "pan-left", name: "Pan left" },
  { id: "pan-right", name: "Pan right" },
  { id: "pan-up", name: "Pan up" },
  { id: "pan-down", name: "Pan down" },
  { id: "zoom-in", name: "Zoom in" },
  { id: "zoom-out", name: "Zoom out" },
  { id: "zoom-rotate-left", name: "Zoom and rotate left" },
  { id: "zoom-rotate-right", name: "Zoom and rotate right" },
  { id: "zoom-out-rotate-left", name: "Zoom out and rotate left" },
  { id: "zoom-out-rotate-right", name: "Zoom out and rotate right" },
];
