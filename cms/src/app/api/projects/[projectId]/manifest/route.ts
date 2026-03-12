import { NextResponse } from "next/server";
import { z } from "zod";
import { generationManifestPath, readJson, writeJson } from "@/lib/projectFiles";
import { listBrands } from "@/lib/brands";

const paramsSchema = z.object({
  projectId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
});

const patchSchema = z.object({
  brandId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const params = paramsSchema.parse(await context.params);
    const body = patchSchema.parse(await request.json());

    const brands = await listBrands();
    if (!brands.some((brand) => brand.id === body.brandId)) {
      return NextResponse.json(
        { error: `Unknown brand '${body.brandId}'` },
        { status: 400 }
      );
    }

    const manifestPath = generationManifestPath(params.projectId);
    const current = await readJson<Record<string, unknown> | null>(manifestPath, null);
    if (!current) {
      return NextResponse.json({ error: "Project manifest not found" }, { status: 404 });
    }

    const next = {
      ...current,
      projectId: params.projectId,
      brandId: body.brandId,
      promptPack: body.brandId,
      voicePack: body.brandId,
      updatedAt: new Date().toISOString(),
    };
    await writeJson(manifestPath, next);
    return NextResponse.json(next);
  } catch (error) {
    console.error("Failed to update project manifest:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update project manifest" }, { status: 400 });
  }
}
