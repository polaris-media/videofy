export const SVP_PROVIDER_ALIASES: Record<string, string> = {
  adresseavisen: "adressa",
  smpno: "smp",
};

export function normalizeSvpKey(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed || undefined;
}

export function resolveSvpProvider(value: string | null | undefined): string | undefined {
  const normalized = normalizeSvpKey(value);
  if (!normalized) {
    return undefined;
  }

  return SVP_PROVIDER_ALIASES[normalized] || normalized;
}

export function inferPolarisNewsroomFromProjectId(
  projectId: string | null | undefined
): string | undefined {
  const normalized = normalizeSvpKey(projectId);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/^polaris-([a-z0-9-]+)-[a-z0-9._-]+$/);
  return match?.[1];
}
