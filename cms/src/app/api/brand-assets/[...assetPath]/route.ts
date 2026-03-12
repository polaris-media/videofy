import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

interface AssetParams {
  assetPath: string[];
}

const BRAND_ASSET_ROOT = join(process.cwd(), "..");

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
};

function resolveSafeAssetPath(parts: string[]): string | null {
  if (!parts.length) {
    return null;
  }

  const relativePath = normalize(parts.join("/")).replace(/^(\.\.(\/|\\|$))+/, "");
  if (!relativePath || relativePath.startsWith("..")) {
    return null;
  }

  const fullPath = join(BRAND_ASSET_ROOT, relativePath);
  const normalizedRoot = `${BRAND_ASSET_ROOT}/`;
  const normalizedFullPath = normalize(fullPath);
  if (!normalizedFullPath.startsWith(normalizedRoot)) {
    return null;
  }

  return normalizedFullPath;
}

export const GET = async (
  _request: Request,
  context: { params: Promise<AssetParams> }
) => {
  const { assetPath } = await context.params;
  const filePath = resolveSafeAssetPath(assetPath || []);

  if (!filePath) {
    return NextResponse.json({ error: "Invalid asset path" }, { status: 400 });
  }

  try {
    const file = await readFile(filePath);
    const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset not found" }, { status: 404 });
  }
};
