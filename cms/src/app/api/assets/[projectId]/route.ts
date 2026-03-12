import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { dataApiFetch } from "@/lib/backend";

interface AssetParams {
  projectId: string;
}

function isSafeProjectId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export const GET = async (
  _request: Request,
  context: { params: Promise<AssetParams> }
) => {
  const { projectId } = await context.params;
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId parameter is required" },
      { status: 400 }
    );
  }
  if (!isSafeProjectId(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  try {
    const imagesDir = join(
      process.cwd(),
      "..",
      "projects",
      projectId,
      "input",
      "images"
    );
    const files = await readdir(imagesDir).catch(() => []);
    return NextResponse.json({ files });
  } catch (error) {
    console.error("Error listing local assets:", error);
    return NextResponse.json(
      { error: "Failed to list local assets" },
      { status: 500 }
    );
  }
};

export const POST = async (
  request: Request,
  context: { params: Promise<AssetParams> }
) => {
  const { projectId } = await context.params;
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId parameter is required" },
      { status: 400 }
    );
  }
  if (!isSafeProjectId(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  try {
    const uploadForm = new FormData();
    uploadForm.append("file", file);

    const response = await dataApiFetch(
      `/api/projects/${projectId}/upload-image`,
      {
        method: "POST",
        body: uploadForm,
      }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Data API upload failed: ${response.status} ${body}`);
    }
    return NextResponse.json({ message: `File ${file.name} uploaded successfully` });
  } catch (error) {
    console.error("Error uploading local asset:", error);
    return NextResponse.json(
      { error: "Failed to upload local asset" },
      { status: 500 }
    );
  }
};
