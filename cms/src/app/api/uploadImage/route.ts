import type { NextRequest } from "next/server";
import sharp from "sharp";
import crypto from "node:crypto";
import { z } from "zod";
import { dataApiFetch } from "@/lib/backend";

const incomingSchema = z.object({
  file: z.instanceof(File),
});

const responseSchema = z.object({
  imageIdentifier: z.string(),
  width: z.number(),
  height: z.number(),
});

export const POST = async (req: NextRequest) => {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return new Response(JSON.stringify({ error: "projectId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectId)) {
      return new Response(JSON.stringify({ error: "Invalid projectId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const formData = await req.formData();

    const file = formData.get("file");

    const incomingValidation = incomingSchema.safeParse({ file });
    if (!incomingValidation.success) {
      const errors = incomingValidation.error.issues
        .map((issue) => `${issue.path.join(".")} - ${issue.message}`)
        .join("; ");
      return new Response(
        JSON.stringify({ error: `Invalid input: ${errors}` }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const imageBytes = new Uint8Array(
      await incomingValidation.data.file.arrayBuffer()
    );
    const metadata = await sharp(Buffer.from(imageBytes)).metadata();
    const uploadForm = new FormData();
    uploadForm.append(
      "file",
      new File([imageBytes], incomingValidation.data.file.name, {
        type: incomingValidation.data.file.type || "application/octet-stream",
      })
    );
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
    const uploadPayload = (await response.json()) as { url: string };

    const result = responseSchema.parse({
      imageIdentifier: crypto.randomUUID(),
      width: metadata.width || 1080,
      height: metadata.height || 1080,
    });

    return new Response(
      JSON.stringify({ url: uploadPayload.url, image: result }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: message,
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
};

export const revalidate = 0;
