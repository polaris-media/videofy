import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { dataApiFetch } from "@/lib/backend";

const incomingSchema = z.object({
  file: z.instanceof(File),
});

export const POST = async (req: NextRequest) => {
  try {
    const projectId = req.nextUrl.searchParams.get("projectId");
    if (!projectId) {
      return new NextResponse(
        JSON.stringify({ error: "projectId is required" }),
        { status: 400 }
      );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectId)) {
      return new NextResponse(JSON.stringify({ error: "Invalid projectId" }), {
        status: 400,
      });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    const incomingValidation = incomingSchema.safeParse({ file });
    if (!incomingValidation.success) {
      const errors = incomingValidation.error.issues
        .map((issue) => `${issue.path.join(".")} - ${issue.message}`)
        .join("; ");
      return new NextResponse(
        JSON.stringify({ error: `Invalid input: ${errors}` }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const fileBytes = new Uint8Array(
      await incomingValidation.data.file.arrayBuffer()
    );
    const uploadForm = new FormData();
    uploadForm.append(
      "file",
      new File([fileBytes], incomingValidation.data.file.name, {
        type: incomingValidation.data.file.type || "audio/wav",
      })
    );
    const response = await dataApiFetch(
      `/api/projects/${projectId}/upload-audio`,
      {
        method: "POST",
        body: uploadForm,
      }
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Data API upload failed: ${response.status} ${body}`);
    }
    const payload = (await response.json()) as { url: string };

    return new NextResponse(JSON.stringify({ url: payload.url }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new NextResponse(
      JSON.stringify({
        error: message,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};

export const revalidate = 0;
