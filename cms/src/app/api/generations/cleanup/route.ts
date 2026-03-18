import { NextResponse } from "next/server";
import { z } from "zod";
import {
  cmsGenerationPath,
  readJson,
  writeJson,
} from "@/lib/projectFiles";
import { getProjectStorage } from "@/lib/projectStorage";

const projectIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const generationTabSchema = z.object({
  articleUrl: z.string().min(1),
  manuscript: z.unknown(),
  projectId: projectIdSchema.optional(),
  backendGenerationId: z.string().min(1).optional(),
});

const requestSchema = z.object({
  generationId: projectIdSchema,
  data: z.array(generationTabSchema),
  retiredProjectIds: z.array(projectIdSchema).optional(),
});

type GenerationTab = z.infer<typeof generationTabSchema>;

type GenerationRecord = {
  id: string;
  projectId: string;
  data: GenerationTab[];
  retiredProjectIds?: string[];
  createdDate: string;
  updatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toDefinedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toProjectId(value: unknown): string | undefined {
  const maybeString = toDefinedString(value);
  return maybeString && projectIdSchema.safeParse(maybeString).success
    ? maybeString
    : undefined;
}

function parseProjectFileReference(
  value: unknown,
  fallbackProjectId?: string
): { projectId: string; path: string } | null {
  const maybeString = toDefinedString(value);
  if (!maybeString) {
    return null;
  }

  const urlMatch = maybeString.match(/\/projects\/([^/]+)\/files\/(.+)$/);
  if (urlMatch) {
    const projectId = toProjectId(urlMatch[1]);
    if (!projectId) {
      return null;
    }

    return {
      projectId,
      path: decodeURIComponent(urlMatch[2]),
    };
  }

  if (
    fallbackProjectId &&
    !maybeString.includes("://") &&
    !maybeString.startsWith("/")
  ) {
    return {
      projectId: fallbackProjectId,
      path: maybeString.replace(/^\.?\//, ""),
    };
  }

  return null;
}

function addReference(
  references: Map<string, Set<string>>,
  reference: { projectId: string; path: string } | null
) {
  if (!reference) {
    return;
  }

  if (!references.has(reference.projectId)) {
    references.set(reference.projectId, new Set());
  }

  references.get(reference.projectId)?.add(reference.path);
}

function collectReferencedFiles(
  tabs: GenerationTab[],
  generationId: string
): { activeProjectIds: Set<string>; references: Map<string, Set<string>> } {
  const activeProjectIds = new Set<string>([generationId]);
  const references = new Map<string, Set<string>>();

  for (const tab of tabs) {
    const tabProjectId =
      toProjectId(tab.projectId) ||
      toProjectId(tab.articleUrl) ||
      generationId;

    activeProjectIds.add(tabProjectId);

    const manuscript = isRecord(tab.manuscript) ? tab.manuscript : {};
    const media = Array.isArray(manuscript.media) ? manuscript.media : [];
    const segments = Array.isArray(manuscript.segments) ? manuscript.segments : [];

    for (const mediaAsset of media) {
      if (!isRecord(mediaAsset)) {
        continue;
      }

      addReference(
        references,
        parseProjectFileReference(mediaAsset.url ?? mediaAsset.path, tabProjectId)
      );
    }

    for (const segmentValue of segments) {
      if (!isRecord(segmentValue)) {
        continue;
      }

      if (isRecord(segmentValue.mainMedia)) {
        addReference(
          references,
          parseProjectFileReference(
            segmentValue.mainMedia.url ?? segmentValue.mainMedia.path,
            tabProjectId
          )
        );
      }

      const images = Array.isArray(segmentValue.images) ? segmentValue.images : [];
      for (const mediaAsset of images) {
        if (!isRecord(mediaAsset)) {
          continue;
        }

        addReference(
          references,
          parseProjectFileReference(mediaAsset.url ?? mediaAsset.path, tabProjectId)
        );
      }

      if (isRecord(segmentValue.customAudio)) {
        addReference(
          references,
          parseProjectFileReference(segmentValue.customAudio.src, tabProjectId)
        );
      }
    }
  }

  return { activeProjectIds, references };
}

async function listProjectFiles(
  projectId: string,
  relativeDir: string
): Promise<string[]> {
  return getProjectStorage().listProjectFiles(projectId, relativeDir);
}

async function deleteFileIfExists(
  projectId: string,
  relativePath: string
): Promise<boolean> {
  return getProjectStorage().deleteProjectFile(projectId, relativePath);
}

async function cleanupProjectFiles(
  projectId: string,
  referencedFiles: Set<string>
): Promise<{ deletedFiles: number; deletedRenderFiles: number }> {
  let deletedFiles = 0;
  let deletedRenderFiles = 0;

  for (const relativeDir of ["input/images", "input/videos", "working/uploads"]) {
    const files = await listProjectFiles(projectId, relativeDir);
    for (const file of files) {
      if (referencedFiles.has(file)) {
        continue;
      }

      if (await deleteFileIfExists(projectId, file)) {
        deletedFiles += 1;
      }
    }
  }

  for (const renderFile of ["output/render-vertical.mp4", "output/render-horizontal.mp4"]) {
    if (await deleteFileIfExists(projectId, renderFile)) {
      deletedFiles += 1;
      deletedRenderFiles += 1;
    }
  }

  for (const transientDir of [
    "working/audio",
    "working/analysis",
    "working/analysis/frames",
    "output",
  ]) {
    const files = await listProjectFiles(projectId, transientDir);
    for (const file of files) {
      if (referencedFiles.has(file)) {
        continue;
      }

      if (await deleteFileIfExists(projectId, file)) {
        deletedFiles += 1;
        if (/^output\/render-.*\.mp4$/i.test(file)) {
          deletedRenderFiles += 1;
        }
      }
    }
  }

  return { deletedFiles, deletedRenderFiles };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unexpected error";
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const { activeProjectIds, references } = collectReferencedFiles(
      body.data,
      body.generationId
    );

    let deletedFiles = 0;
    let deletedRenderFiles = 0;

    for (const projectId of activeProjectIds) {
      const result = await cleanupProjectFiles(
        projectId,
        references.get(projectId) || new Set()
      );
      deletedFiles += result.deletedFiles;
      deletedRenderFiles += result.deletedRenderFiles;
    }

    const existing = await readJson<GenerationRecord | null>(
      cmsGenerationPath(body.generationId),
      null
    );

    const retiredProjectIds = [
      ...(existing?.retiredProjectIds || []),
      ...(body.retiredProjectIds || []),
    ].filter((projectId, index, allIds) => {
      return (
        projectId &&
        projectId !== body.generationId &&
        allIds.indexOf(projectId) === index
      );
    });

    const deletedProjects: string[] = [];
    for (const retiredProjectId of retiredProjectIds) {
      if (activeProjectIds.has(retiredProjectId)) {
        continue;
      }

      await getProjectStorage().deleteProjectTree(retiredProjectId);
      deletedProjects.push(retiredProjectId);
    }

    if (existing) {
      const remainingRetiredProjectIds = retiredProjectIds.filter(
        (projectId) => !deletedProjects.includes(projectId)
      );
      const { config: _legacyConfig, ...sanitizedExisting } = existing as GenerationRecord & {
        config?: unknown;
      };
      await writeJson(cmsGenerationPath(body.generationId), {
        ...sanitizedExisting,
        retiredProjectIds:
          remainingRetiredProjectIds.length > 0
            ? remainingRetiredProjectIds
            : undefined,
      });
    }

    return NextResponse.json({
      projectsScanned: activeProjectIds.size,
      deletedFiles,
      deletedRenderFiles,
      deletedProjects,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }

    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export const revalidate = 0;
