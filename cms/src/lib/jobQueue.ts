import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { renderProjectVideo } from "@/lib/remotionRender";
import { dataApiFetch } from "@/lib/backend";
import { jobFilePath, jobsRoot, jobWorkerLockPath } from "@/lib/projectFiles";
import { buildProjectFileUrl } from "@/lib/projectFileUrl";

const JOB_LOCK_TTL_MS = 15 * 60 * 1000;

export type JobKind = "generate-manuscript" | "process-manuscript" | "render-video";
export type JobStatus = "pending" | "running" | "completed" | "failed";

export type GenerateManuscriptJobPayload = {
  projectId: string;
};

export type ProcessManuscriptJobPayload = {
  projectId: string;
  manuscript: unknown;
  audioMode: "none" | "elevenlabs";
};

export type RenderVideoJobPayload = {
  projectId: string;
  orientations: Array<"vertical" | "horizontal">;
  manuscripts: unknown[];
  playerConfig: unknown;
  voice: boolean;
  backgroundMusic: boolean;
  disabledLogo: boolean;
  splitArticles: boolean;
};

type JobPayloadByKind = {
  "generate-manuscript": GenerateManuscriptJobPayload;
  "process-manuscript": ProcessManuscriptJobPayload;
  "render-video": RenderVideoJobPayload;
};

type JobResultByKind = {
  "generate-manuscript": {
    manuscript_json?: unknown;
  };
  "process-manuscript": {
    processed_json?: unknown;
  };
  "render-video": {
    downloads: Array<{
      kind: "combined" | "article";
      orientation: "vertical" | "horizontal";
      downloadUrl: string;
      articleIndex?: number;
      articleTitle?: string;
    }>;
    downloadUrl?: string;
  };
};

export type JobRecord<K extends JobKind = JobKind> = {
  id: string;
  kind: K;
  status: JobStatus;
  projectId: string;
  payload: JobPayloadByKind[K];
  result?: JobResultByKind[K];
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

let activeRunner: Promise<void> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

async function ensureJobsRoot() {
  await mkdir(jobsRoot(), { recursive: true });
}

async function readJobFile<K extends JobKind = JobKind>(jobId: string): Promise<JobRecord<K> | null> {
  try {
    const raw = await readFile(jobFilePath(jobId), "utf-8");
    return JSON.parse(raw) as JobRecord<K>;
  } catch {
    return null;
  }
}

async function writeJobFile(job: JobRecord): Promise<void> {
  await ensureJobsRoot();
  await writeFile(jobFilePath(job.id), JSON.stringify(job, null, 2), "utf-8");
}

async function listJobs(): Promise<JobRecord[]> {
  await ensureJobsRoot();
  const entries = await readdir(jobsRoot(), { withFileTypes: true });
  const jobIds = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "worker.lock.json")
    .map((entry) => entry.name.replace(/\.json$/i, ""));
  const jobs = await Promise.all(jobIds.map((jobId) => readJobFile(jobId)));
  return jobs.filter((job): job is JobRecord => Boolean(job));
}

async function acquireWorkerLock(): Promise<boolean> {
  await ensureJobsRoot();
  const lockPath = jobWorkerLockPath();
  const lockPayload = {
    pid: process.pid,
    acquiredAt: nowIso(),
  };

  try {
    await writeFile(lockPath, JSON.stringify(lockPayload, null, 2), {
      encoding: "utf-8",
      flag: "wx",
    });
    return true;
  } catch {
    try {
      const raw = await readFile(lockPath, "utf-8");
      const parsed = JSON.parse(raw) as { acquiredAt?: string };
      const acquiredAt = typeof parsed.acquiredAt === "string" ? Date.parse(parsed.acquiredAt) : NaN;
      if (Number.isFinite(acquiredAt) && Date.now() - acquiredAt > JOB_LOCK_TTL_MS) {
        await rm(lockPath, { force: true });
        return acquireWorkerLock();
      }
    } catch {
      await rm(lockPath, { force: true }).catch(() => undefined);
      return acquireWorkerLock();
    }
    return false;
  }
}

async function releaseWorkerLock(): Promise<void> {
  await rm(jobWorkerLockPath(), { force: true }).catch(() => undefined);
}

async function recoverStaleRunningJobs(): Promise<void> {
  const jobs = await listJobs();
  const threshold = Date.now() - JOB_LOCK_TTL_MS;

  await Promise.all(
    jobs.map(async (job) => {
      if (job.status !== "running") {
        return;
      }

      const updatedAt = Date.parse(job.updatedAt);
      if (!Number.isFinite(updatedAt) || updatedAt >= threshold) {
        return;
      }

      await writeJobFile({
        ...job,
        status: "failed",
        error: "Job was interrupted or exceeded the local worker lock TTL.",
        finishedAt: nowIso(),
        updatedAt: nowIso(),
      });
    })
  );
}

async function claimNextJob(): Promise<JobRecord | null> {
  const jobs = await listJobs();
  const next = jobs
    .filter((job) => job.status === "pending")
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

  if (!next) {
    return null;
  }

  const runningJob: JobRecord = {
    ...next,
    status: "running",
    startedAt: nowIso(),
    updatedAt: nowIso(),
    error: undefined,
  };
  await writeJobFile(runningJob);
  return runningJob;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Unexpected job error";
}

async function executeGenerateJob(job: JobRecord<"generate-manuscript">) {
  const response = await dataApiFetch(`/api/projects/${job.projectId}/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Generate failed (${response.status}): ${body}`);
  }
  return JSON.parse(body) as JobResultByKind["generate-manuscript"];
}

async function executeProcessJob(job: JobRecord<"process-manuscript">) {
  const response = await dataApiFetch(`/api/projects/${job.projectId}/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      manuscript: job.payload.manuscript,
      audio_mode: job.payload.audioMode,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Process failed (${response.status}): ${body}`);
  }
  return JSON.parse(body) as JobResultByKind["process-manuscript"];
}

async function executeRenderJob(job: JobRecord<"render-video">) {
  const downloads: JobResultByKind["render-video"]["downloads"] = [];

  for (const orientation of job.payload.orientations) {
    await renderProjectVideo({
      projectId: job.projectId,
      orientation,
      manuscripts: job.payload.manuscripts,
      playerConfig: job.payload.playerConfig,
      voice: job.payload.voice,
      backgroundMusic: job.payload.backgroundMusic,
      disabledLogo: job.payload.disabledLogo,
    });

    downloads.push({
      kind: "combined",
      orientation,
      downloadUrl: buildProjectFileUrl(job.projectId, `output/render-${orientation}.mp4`),
    });

    if (job.payload.splitArticles && job.payload.manuscripts.length > 1) {
      for (const [articleIndex, manuscript] of job.payload.manuscripts.entries()) {
        const paddedArticleIndex = String(articleIndex + 1).padStart(2, "0");
        const outputFileName = `render-${orientation}-article-${paddedArticleIndex}.mp4`;

        await renderProjectVideo({
          projectId: job.projectId,
          orientation,
          manuscripts: [manuscript],
          playerConfig: job.payload.playerConfig,
          voice: job.payload.voice,
          backgroundMusic: job.payload.backgroundMusic,
          disabledLogo: job.payload.disabledLogo,
          outputFileName,
          storyIndicator: {
            length: job.payload.manuscripts.length,
            current: articleIndex,
          },
        });

        const articleTitle =
          manuscript &&
          typeof manuscript === "object" &&
          "meta" in manuscript &&
          manuscript.meta &&
          typeof manuscript.meta === "object" &&
          "title" in manuscript.meta &&
          typeof manuscript.meta.title === "string"
            ? manuscript.meta.title
            : undefined;

        downloads.push({
          kind: "article",
          orientation,
          articleIndex: articleIndex + 1,
          articleTitle,
          downloadUrl: buildProjectFileUrl(job.projectId, `output/${outputFileName}`),
        });
      }
    }
  }

  return {
    downloads,
    downloadUrl: downloads.find((download) => download.kind === "combined")?.downloadUrl,
  } satisfies JobResultByKind["render-video"];
}

async function executeJob(job: JobRecord): Promise<JobRecord["result"]> {
  switch (job.kind) {
    case "generate-manuscript":
      return executeGenerateJob(job as JobRecord<"generate-manuscript">);
    case "process-manuscript":
      return executeProcessJob(job as JobRecord<"process-manuscript">);
    case "render-video":
      return executeRenderJob(job as JobRecord<"render-video">);
    default:
      throw new Error(`Unsupported job kind: ${String(job.kind)}`);
  }
}

async function processJobQueueLoop(): Promise<void> {
  if (!(await acquireWorkerLock())) {
    return;
  }

  try {
    await recoverStaleRunningJobs();
    while (true) {
      const job = await claimNextJob();
      if (!job) {
        break;
      }

      try {
        const result = await executeJob(job);
        await writeJobFile({
          ...job,
          status: "completed",
          result,
          finishedAt: nowIso(),
          updatedAt: nowIso(),
        });
      } catch (error) {
        await writeJobFile({
          ...job,
          status: "failed",
          error: toErrorMessage(error),
          finishedAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    }
  } finally {
    await releaseWorkerLock();
  }
}

export function triggerJobQueue(): void {
  if (activeRunner) {
    return;
  }
  activeRunner = processJobQueueLoop().finally(() => {
    activeRunner = null;
  });
}

export async function createJob<K extends JobKind>(
  kind: K,
  payload: JobPayloadByKind[K]
): Promise<JobRecord<K>> {
  const id = `job-${crypto.randomUUID()}`;
  const record: JobRecord<K> = {
    id,
    kind,
    status: "pending",
    projectId: payload.projectId,
    payload,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await writeJobFile(record);
  triggerJobQueue();
  return record;
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  triggerJobQueue();
  return readJobFile(jobId);
}
