import { manuscriptSchema } from "@videofy/types";
import { z } from "zod";
import {
  cmsGenerationPath,
  generationManifestPath,
  readJson,
  workingManuscriptPath,
} from "@/lib/projectFiles";
import { getProjectStorage } from "@/lib/projectStorage";

type StoredGenerationTab = {
  articleUrl: string;
  manuscript: z.infer<typeof manuscriptSchema>;
  projectId?: string;
  backendGenerationId?: string;
};

export type StoredGenerationRecord = {
  id: string;
  projectId: string;
  data: StoredGenerationTab[];
  retiredProjectIds?: string[];
  brandId?: string;
  project?: {
    id: string;
    name: string;
  };
  createdDate: string;
  updatedAt: string;
  config?: unknown;
};

const fallbackManifestSchema = z.object({
  brandId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toISOString();
}

function buildFallbackGenerationRecord(
  projectId: string,
  manifest: z.infer<typeof fallbackManifestSchema>,
  manuscript: z.infer<typeof manuscriptSchema>
): StoredGenerationRecord {
  const now = new Date().toISOString();
  const createdDate = normalizeTimestamp(manifest.createdAt, now);
  const updatedAt = normalizeTimestamp(manifest.updatedAt, createdDate);
  const title = manuscript.meta.title.trim() || projectId;
  const articleUrl = manuscript.meta.articleUrl?.trim() || projectId;

  return {
    id: projectId,
    projectId,
    data: [
      {
        articleUrl,
        manuscript,
        projectId,
      },
    ],
    brandId: manifest.brandId,
    project: {
      id: projectId,
      name: title,
    },
    createdDate,
    updatedAt,
  };
}

export async function readStoredGenerationRecord(
  projectId: string
): Promise<StoredGenerationRecord | null> {
  const generation = await readJson<StoredGenerationRecord | null>(
    cmsGenerationPath(projectId),
    null
  );
  if (generation) {
    return generation;
  }

  if (await getProjectStorage().fileExists(cmsGenerationPath(projectId))) {
    return null;
  }

  const [manifestRaw, manuscriptRaw] = await Promise.all([
    readJson<unknown>(generationManifestPath(projectId), null),
    readJson<unknown>(workingManuscriptPath(projectId), null),
  ]);

  const manifest = fallbackManifestSchema.safeParse(manifestRaw);
  const manuscript = manuscriptSchema.safeParse(manuscriptRaw);
  if (!manifest.success || !manuscript.success) {
    return null;
  }

  return buildFallbackGenerationRecord(projectId, manifest.data, manuscript.data);
}
