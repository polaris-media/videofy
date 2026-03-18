import { generationModelEnum } from "@videofy/types";
import { z } from "zod";

export type GenerationModel = z.infer<typeof generationModelEnum>;

const ALL_GENERATION_MODEL_OPTIONS: Array<{
  value: GenerationModel;
  label: string;
}> = [
  { value: "gpt-4o", label: "gpt-4o" },
  { value: "gpt-5.1", label: "gpt-5.1" },
  { value: "gpt-5.4", label: "gpt-5.4" },
];

const DEFAULT_ENABLED_GENERATION_MODELS: GenerationModel[] = ["gpt-4o", "gpt-5.1"];

function getAvailableGenerationModels(): GenerationModel[] {
  const configured = process.env.NEXT_PUBLIC_VIDEOFY_GENERATION_MODELS;
  if (!configured) {
    return DEFAULT_ENABLED_GENERATION_MODELS;
  }

  const parsed = configured
    .split(",")
    .map((value) => generationModelEnum.safeParse(value.trim()))
    .filter((result): result is z.ZodSafeParseSuccess<GenerationModel> => result.success)
    .map((result) => result.data);

  return parsed.length > 0 ? parsed : DEFAULT_ENABLED_GENERATION_MODELS;
}

export const AVAILABLE_GENERATION_MODELS = getAvailableGenerationModels();

export const GENERATION_MODEL_OPTIONS: Array<{
  value: GenerationModel;
  label: string;
}> = ALL_GENERATION_MODEL_OPTIONS.filter((option) =>
  AVAILABLE_GENERATION_MODELS.includes(option.value)
);

export function resolveGenerationModel(
  value: string | undefined,
  fallback: GenerationModel = "gpt-4o"
): GenerationModel {
  const parsed = generationModelEnum.safeParse(value);
  const normalizedFallback = AVAILABLE_GENERATION_MODELS.includes(fallback)
    ? fallback
    : AVAILABLE_GENERATION_MODELS[0] || "gpt-4o";

  if (parsed.success && AVAILABLE_GENERATION_MODELS.includes(parsed.data)) {
    return parsed.data;
  }

  return normalizedFallback;
}
