const DEFAULT_DATA_API_URL = "http://127.0.0.1:8001";

export function getDataApiUrl(): string {
  return (process.env.MINIMAL_DATA_API_URL || DEFAULT_DATA_API_URL).replace(
    /\/$/,
    ""
  );
}

export async function dataApiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${getDataApiUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown fetch error";
    throw new Error(`Data API request failed for ${url}: ${message}`);
  }
}
