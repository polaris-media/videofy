export type ApiJobStatus = "pending" | "running" | "completed" | "failed";

export type ApiJobSnapshot<T = unknown> = {
  id: string;
  kind: "generate-manuscript" | "process-manuscript" | "render-video";
  status: ApiJobStatus;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: T;
  error?: string;
};

function getCmsBaseUrl(): string {
  return (
    typeof window !== "undefined"
      ? window.location.origin
      : process.env.NEXT_PUBLIC_CMS_BASE_URL || "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function createJob<TPayload extends Record<string, unknown>>(body: {
  kind: "generate-manuscript" | "process-manuscript" | "render-video";
  payload: TPayload;
}): Promise<{ jobId: string; kind: string; status: ApiJobStatus }> {
  const response = await fetch(`${getCmsBaseUrl()}/api/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return parseJsonResponse(response);
}

export async function getJob<T = unknown>(jobId: string): Promise<ApiJobSnapshot<T>> {
  const response = await fetch(`${getCmsBaseUrl()}/api/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
  });
  return parseJsonResponse(response);
}
