import { generationModelEnum } from "@videofy/types";
import { z } from "zod";

export type GenerationModel = z.infer<typeof generationModelEnum>;

export const GENERATION_MODEL_OPTIONS: Array<{
  value: GenerationModel;
  label: string;
}> = [
  { value: "gpt-4o", label: "gpt-4o" },
  { value: "gpt-5.1", label: "gpt-5.1" },
  { value: "gpt-5.4", label: "gpt-5.4" },
];

export function resolveGenerationModel(
  value: string | undefined,
  fallback: GenerationModel = "gpt-4o"
): GenerationModel {
  const parsed = generationModelEnum.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}
