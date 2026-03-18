import { NextResponse } from "next/server";
import { dataApiFetch } from "@/lib/backend";

type Params = {
  projectId: string;
  filePath: string[];
};

const SAFE_PROJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PROXY_HEADER_NAMES = [
  "accept",
  "range",
  "if-none-match",
  "if-modified-since",
] as const;
const RESPONSE_HEADER_NAMES = [
  "accept-ranges",
  "cache-control",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const;

export const runtime = "nodejs";

function encodePathSegments(pathSegments: string[]): string {
  return pathSegments.map((segment) => encodeURIComponent(segment)).join("/");
}

function buildProxyHeaders(request: Request): Headers {
  const headers = new Headers();

  for (const headerName of PROXY_HEADER_NAMES) {
    const value = request.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

function buildResponseHeaders(response: Response): Headers {
  const headers = new Headers();

  for (const headerName of RESPONSE_HEADER_NAMES) {
    const value = response.headers.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

async function proxyProjectFile(
  request: Request,
  context: { params: Promise<Params> }
) {
  const { projectId, filePath } = await context.params;

  if (!projectId || !SAFE_PROJECT_ID_PATTERN.test(projectId)) {
    return NextResponse.json({ error: "Invalid projectId" }, { status: 400 });
  }

  if (!Array.isArray(filePath) || filePath.length === 0) {
    return NextResponse.json({ error: "filePath is required" }, { status: 400 });
  }

  const upstreamResponse = await dataApiFetch(
    `/projects/${encodeURIComponent(projectId)}/files/${encodePathSegments(filePath)}`,
    {
      method: request.method,
      headers: buildProxyHeaders(request),
    }
  );
  const responseHeaders = buildResponseHeaders(upstreamResponse);

  if (!upstreamResponse.ok) {
    return new Response(await upstreamResponse.text(), {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

export const GET = proxyProjectFile;
export const HEAD = proxyProjectFile;
