"use server";

import { ProcessedManuscript } from "@videofy/types";

export async function logAIData(
  _manuscripts: Array<ProcessedManuscript>,
  _generationId: string
) {
  // Disabled in minimal mode.
  return { success: true };
}
