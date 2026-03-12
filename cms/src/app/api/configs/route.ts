import { NextResponse } from "next/server";
import { appConfigSchema } from "@videofy/types";
import { z } from "zod";
import {
  GenerationManifest,
  configOverridePath,
  generationManifestPath,
  listProjectIds,
  readJson,
  writeJson,
} from "@/lib/projectFiles";
import { resolveConfigForProject } from "@/lib/configResolver";

type ConfigRow = {
  projectId: string;
  config: unknown;
};

const projectQuerySchema = z.object({
  projectId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .optional(),
});

const manifestSchema = z.object({
  projectId: z.string().min(1),
  brandId: z.string().min(1),
  promptPack: z.string().min(1),
  voicePack: z.string().min(1),
  options: z
    .object({
      orientationDefault: z.enum(["vertical", "horizontal"]).optional(),
      segmentPauseSeconds: z.number().optional(),
    })
    .optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

const saveSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  config: appConfigSchema,
});

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected error";
}

async function readManifest(projectId: string): Promise<GenerationManifest | null> {
  const raw = await readJson<unknown>(generationManifestPath(projectId), null);
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { projectId: requestedProjectId } = projectQuerySchema.parse({
      projectId: searchParams.get("projectId") || undefined,
    });

    if (requestedProjectId) {
      const manifest = await readManifest(requestedProjectId);
      if (!manifest) {
        return NextResponse.json({ error: "Config not found" }, { status: 404 });
      }

      const config = await resolveConfigForProject(requestedProjectId, manifest);
      return NextResponse.json({
        projectId: requestedProjectId,
        config,
      });
    }

    const projectIds = await listProjectIds();
    const configs: ConfigRow[] = [];

    for (const projectId of projectIds) {
      const manifest = await readManifest(projectId);
      if (!manifest) {
        continue;
      }

      const config = await resolveConfigForProject(projectId, manifest);
      configs.push({
        projectId,
        config,
      });
    }

    return NextResponse.json(configs);
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = saveSchema.parse(await request.json());
    await writeJson(configOverridePath(parsed.projectId), parsed.config);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 500 });
  }
}
