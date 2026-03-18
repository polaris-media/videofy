import { NextResponse } from "next/server";
import { z } from "zod";
import { aiUsagePath, cmsGenerationPath, listProjectIds, readJson } from "@/lib/projectFiles";
import { detectProjectNewsroom } from "@/lib/newsroomBranding";

const querySchema = z.object({
  projectId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
    .optional(),
  newsroom: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/)
    .optional(),
});

type UsageTotals = {
  openai: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens: number;
  };
  elevenlabs: {
    calls: number;
    characters: number;
  };
  preview: {
    withoutAudio: number;
    withElevenLabs: number;
  };
};

type UsageSummary = {
  projectId?: string;
  updatedAt?: string;
  totals: UsageTotals;
  recent?: Array<Record<string, unknown>>;
};

type GenerationSnapshot = {
  brandId?: string;
  project?: {
    name?: string;
  };
  data?: Array<{
    manuscript?: {
      meta?: {
        title?: string;
      };
    };
  }>;
};

type ProjectUsageSummary = UsageSummary & {
  projectId: string;
  brandId?: string;
  newsroom?: string;
  title?: string;
  articleCount: number;
};

type GroupSummary = {
  key: string;
  label: string;
  projectCount: number;
  totals: UsageTotals;
};

function emptyTotals(): UsageTotals {
  return {
    openai: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
    },
    elevenlabs: {
      calls: 0,
      characters: 0,
    },
    preview: {
      withoutAudio: 0,
      withElevenLabs: 0,
    },
  };
}

function emptySummary(projectId?: string): UsageSummary {
  return {
    projectId,
    totals: emptyTotals(),
    recent: [],
  };
}

function mergeSummaries(target: UsageTotals, source?: UsageTotals) {
  if (!source) {
    return;
  }

  target.openai.calls += source.openai.calls || 0;
  target.openai.inputTokens += source.openai.inputTokens || 0;
  target.openai.outputTokens += source.openai.outputTokens || 0;
  target.openai.totalTokens += source.openai.totalTokens || 0;
  target.openai.reasoningTokens += source.openai.reasoningTokens || 0;
  target.elevenlabs.calls += source.elevenlabs.calls || 0;
  target.elevenlabs.characters += source.elevenlabs.characters || 0;
  target.preview.withoutAudio += source.preview.withoutAudio || 0;
  target.preview.withElevenLabs += source.preview.withElevenLabs || 0;
}

async function readUsage(projectId: string): Promise<UsageSummary> {
  const summary = await readJson<UsageSummary | null>(aiUsagePath(projectId), null);
  if (!summary || typeof summary !== "object" || !summary.totals) {
    return emptySummary(projectId);
  }

  return {
    projectId,
    updatedAt: summary.updatedAt,
    totals: {
      ...emptyTotals(),
      ...summary.totals,
      openai: {
        ...emptyTotals().openai,
        ...(summary.totals.openai || {}),
      },
      elevenlabs: {
        ...emptyTotals().elevenlabs,
        ...(summary.totals.elevenlabs || {}),
      },
      preview: {
        ...emptyTotals().preview,
        ...(summary.totals.preview || {}),
      },
    },
    recent: Array.isArray(summary.recent) ? summary.recent : [],
  };
}

async function readGenerationSnapshot(projectId: string): Promise<GenerationSnapshot | null> {
  return readJson<GenerationSnapshot | null>(cmsGenerationPath(projectId), null);
}

function buildProjectTitle(projectId: string, generation: GenerationSnapshot | null): string {
  const firstTitle = generation?.data?.[0]?.manuscript?.meta?.title?.trim();
  if (firstTitle) {
    return firstTitle;
  }

  const projectName = generation?.project?.name?.trim();
  return projectName || projectId;
}

async function readProjectUsage(projectId: string): Promise<ProjectUsageSummary> {
  const [usage, generation, newsroom] = await Promise.all([
    readUsage(projectId),
    readGenerationSnapshot(projectId),
    detectProjectNewsroom(projectId),
  ]);

  return {
    ...usage,
    projectId,
    brandId: generation?.brandId,
    newsroom,
    title: buildProjectTitle(projectId, generation),
    articleCount: Array.isArray(generation?.data) ? generation!.data!.length : 0,
  };
}

function upsertGroup(
  map: Map<string, GroupSummary>,
  key: string | undefined,
  label: string | undefined,
  totals: UsageTotals
) {
  if (!key || !label) {
    return;
  }

  const existing =
    map.get(key) ||
    {
      key,
      label,
      projectCount: 0,
      totals: emptyTotals(),
    };
  existing.projectCount += 1;
  mergeSummaries(existing.totals, totals);
  map.set(key, existing);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const { projectId, newsroom } = querySchema.parse({
      projectId: searchParams.get("projectId") || undefined,
      newsroom: searchParams.get("newsroom") || undefined,
    });

    if (projectId) {
      return NextResponse.json(await readProjectUsage(projectId));
    }

    const projectIds = await listProjectIds();
    const allProjects = await Promise.all(projectIds.map((id) => readProjectUsage(id)));
    const projects = newsroom
      ? allProjects.filter((project) => project.newsroom === newsroom)
      : allProjects;
    const totals = emptyTotals();
    const newsroomGroups = new Map<string, GroupSummary>();
    const brandGroups = new Map<string, GroupSummary>();

    projects.forEach((project) => {
      mergeSummaries(totals, project.totals);
      upsertGroup(
        newsroomGroups,
        project.newsroom,
        project.newsroom?.toUpperCase(),
        project.totals
      );
      upsertGroup(
        brandGroups,
        project.brandId,
        project.brandId,
        project.totals
      );
    });

    const sortedProjects = projects
      .filter((project) => project.updatedAt)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .slice(0, 8);

    const sortGroups = (values: Iterable<GroupSummary>) =>
      [...values].sort((left, right) => right.totals.openai.totalTokens - left.totals.openai.totalTokens);

    return NextResponse.json({
      totals,
      groups: {
        newsrooms: sortGroups(newsroomGroups.values()),
        brands: sortGroups(brandGroups.values()),
      },
      projects: sortedProjects,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
