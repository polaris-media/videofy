import { readJson, newsroomBrandingPath, projectDir } from "@/lib/projectFiles";

export type NewsroomBrandingEntry = {
  domain?: string;
  image?: string;
  text?: string;
  logoMode?: "auto" | "image" | "text";
  logoStyle?: string;
  logoTextStyle?: string;
  disableIntro?: boolean;
  disableWipe?: boolean;
  disableOutro?: boolean;
  player?: Record<string, unknown>;
};

export type NewsroomBrandingFile = {
  default?: NewsroomBrandingEntry;
  newsrooms?: Record<string, NewsroomBrandingEntry>;
};

type PolarisSourcePayload = {
  newsroom?: string;
  sourceUrl?: string | null;
};

export type ResolvedNewsroomBranding = NewsroomBrandingEntry & {
  newsroom?: string;
  faviconUrl?: string;
};

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeNewsroomKey(value: string | undefined): string | undefined {
  return value ? value.trim().toLowerCase() : undefined;
}

function toHost(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

function toFaviconUrl(host: string | undefined): string | undefined {
  if (!host) {
    return undefined;
  }
  return `https://${host}/favicon.ico`;
}

function deepMergeRecords(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = deepMergeRecords(
        current as Record<string, unknown>,
        value as Record<string, unknown>
      );
    } else {
      out[key] = value;
    }
  }

  return out;
}

function mergeBranding(
  base: NewsroomBrandingEntry | undefined,
  override: NewsroomBrandingEntry | undefined
): NewsroomBrandingEntry {
  const basePlayer =
    base?.player && typeof base.player === "object" ? base.player : undefined;
  const overridePlayer =
    override?.player && typeof override.player === "object" ? override.player : undefined;

  return {
    ...(base || {}),
    ...(override || {}),
    ...(basePlayer || overridePlayer
      ? {
          player: deepMergeRecords(basePlayer || {}, overridePlayer || {}),
        }
      : {}),
  };
}

export async function readNewsroomBrandingFile(): Promise<NewsroomBrandingFile> {
  return readJson<NewsroomBrandingFile>(newsroomBrandingPath(), {});
}

export async function detectProjectNewsroom(projectId: string): Promise<string | undefined> {
  const source = await readJson<PolarisSourcePayload | null>(
    `${projectDir(projectId)}/working/polaris_capi_source.json`,
    null
  );

  return normalizeNewsroomKey(trimToUndefined(source?.newsroom));
}

export async function resolveNewsroomBranding(
  projectId: string
): Promise<ResolvedNewsroomBranding | null> {
  const brandingFile = await readNewsroomBrandingFile();
  const source = await readJson<PolarisSourcePayload | null>(
    `${projectDir(projectId)}/working/polaris_capi_source.json`,
    null
  );

  const newsroom = normalizeNewsroomKey(trimToUndefined(source?.newsroom));
  const entry = newsroom ? brandingFile.newsrooms?.[newsroom] : undefined;
  const merged = mergeBranding(brandingFile.default, entry);

  const configuredDomain = trimToUndefined(merged.domain);
  const sourceHost = toHost(trimToUndefined(source?.sourceUrl) || undefined);
  const faviconUrl =
    trimToUndefined(merged.image) ||
    toFaviconUrl(configuredDomain || sourceHost);

  const hasBranding =
    Boolean(newsroom) ||
    Boolean(faviconUrl) ||
    Boolean(trimToUndefined(merged.text)) ||
    Boolean(trimToUndefined(merged.logoStyle)) ||
    Boolean(trimToUndefined(merged.logoTextStyle)) ||
    Boolean(merged.disableIntro) ||
    Boolean(merged.disableWipe) ||
    Boolean(merged.disableOutro) ||
    Boolean(merged.player && Object.keys(merged.player).length > 0);

  if (!hasBranding) {
    return null;
  }

  return {
    ...merged,
    newsroom,
    faviconUrl,
  };
}
