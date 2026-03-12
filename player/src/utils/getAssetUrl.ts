/**
 * Gets full URL for an asset - returns URL directly or prepends API server URL
 * @param asset - Either a full URL or a relative asset path
 * @returns Full URL string
 */
export function getAssetUrl(baseUrl: string, asset: string = ""): string {
  // Check if already a URL (http/https/data URI)

  if (/^(https?:|data:)/.test(asset || "")) {
    return asset;
  }

  // Join URLs safely without double slashes
  return `${baseUrl}/${asset.replace(/^\//, "")}`;
}
