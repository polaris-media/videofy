"use client";

import { Card, Flex, Spin, Typography } from "antd";
import { useMemo } from "react";
import { type AIUsageProjectSummary, useAIUsage } from "@/api";

type Props = {
  projectId?: string;
  newsroom?: string;
  compact?: boolean;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("nb-NO").format(value);
}

function isAggregatePayload(
  value: unknown
): value is {
  totals: AIUsageProjectSummary["totals"];
  projects: AIUsageProjectSummary[];
  groups: {
    newsrooms: Array<{
      key: string;
      label: string;
      projectCount: number;
      totals: AIUsageProjectSummary["totals"];
    }>;
    brands: Array<{
      key: string;
      label: string;
      projectCount: number;
      totals: AIUsageProjectSummary["totals"];
    }>;
  };
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      "projects" in value &&
      Array.isArray((value as { projects?: unknown }).projects)
  );
}

const AIUsageDashboard = ({ projectId, newsroom, compact = false }: Props) => {
  const { data, isLoading } = useAIUsage(projectId, newsroom);
  const isNewsroomScope = Boolean(newsroom && !projectId);

  const summary = useMemo(() => {
    if (!data) {
      return null;
    }
    return isAggregatePayload(data) ? data.totals : data.totals;
  }, [data]);

  const projects = useMemo(() => {
    if (!data || !isAggregatePayload(data)) {
      return [];
    }
    return data.projects.slice(0, compact ? 3 : 5);
  }, [compact, data]);
  const newsroomGroups = useMemo(() => {
    if (!data || !isAggregatePayload(data)) {
      return [];
    }
    return data.groups.newsrooms.slice(0, compact ? 3 : 6);
  }, [compact, data]);
  const brandGroups = useMemo(() => {
    if (!data || !isAggregatePayload(data)) {
      return [];
    }
    return data.groups.brands.slice(0, compact ? 3 : 6);
  }, [compact, data]);

  return (
    <Card
      size={compact ? "small" : "default"}
      style={{
        background: "rgba(255,255,255,0.94)",
        borderColor: "#dbe5f3",
        boxShadow: "0 14px 36px rgba(148, 163, 184, 0.12)",
      }}
    >
      <Flex justify="space-between" align="start" gap="middle" style={{ marginBottom: 12 }}>
        <div>
          <Typography.Title level={5} style={{ marginBottom: 4 }}>
            AI usage
          </Typography.Title>
          <Typography.Text type="secondary">
            {projectId
              ? "Gjeldende story"
              : isNewsroomScope
                ? `Kun ${newsroom?.toUpperCase()}`
                : "Samlet oversikt over GPT- og ElevenLabs-kall"}
          </Typography.Text>
        </div>
        {isLoading ? <Spin size="small" /> : null}
      </Flex>

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <Typography.Text type="secondary">OpenAI-kall</Typography.Text>
            <Typography.Title level={4} style={{ margin: "4px 0 0" }}>
              {formatNumber(summary.openai.calls)}
            </Typography.Title>
            <Typography.Text type="secondary">
              {formatNumber(summary.openai.totalTokens)} tokens totalt
            </Typography.Text>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <Typography.Text type="secondary">ElevenLabs-kall</Typography.Text>
            <Typography.Title level={4} style={{ margin: "4px 0 0" }}>
              {formatNumber(summary.elevenlabs.calls)}
            </Typography.Title>
            <Typography.Text type="secondary">
              {formatNumber(summary.elevenlabs.characters)} tegn sendt
            </Typography.Text>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <Typography.Text type="secondary">Preview-modus</Typography.Text>
            <Typography.Title level={4} style={{ margin: "4px 0 0" }}>
              {formatNumber(summary.preview.withoutAudio)} / {formatNumber(summary.preview.withElevenLabs)}
            </Typography.Title>
            <Typography.Text type="secondary">
              uten lyd / med ElevenLabs
            </Typography.Text>
          </div>
        </div>
      ) : (
        <Typography.Text type="secondary">Ingen AI-usage registrert ennå.</Typography.Text>
      )}

      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 12 }}>
        Pris beregnes ikke direkte her. Visningen følger token- og tegnforbruk slik at du ser de
        viktigste kostnadsdriverne.
      </Typography.Paragraph>

      {!isNewsroomScope && newsroomGroups.length > 0 ? (
        <div className="mt-4">
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Per newsroom
          </Typography.Text>
          <div className="grid gap-2">
            {newsroomGroups.map((group) => (
              <div
                key={`newsroom-${group.key}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <Typography.Text strong style={{ display: "block" }}>
                  {group.label}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {group.projectCount} prosjekter • GPT {formatNumber(group.totals.openai.calls)} •
                  ElevenLabs {formatNumber(group.totals.elevenlabs.calls)}
                </Typography.Text>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {brandGroups.length > 0 ? (
        <div className="mt-4">
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Per profil
          </Typography.Text>
          <div className="grid gap-2">
            {brandGroups.map((group) => (
              <div
                key={`brand-${group.key}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <Typography.Text strong style={{ display: "block" }}>
                  {group.label}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {group.projectCount} prosjekter • GPT {formatNumber(group.totals.openai.calls)} •
                  ElevenLabs {formatNumber(group.totals.elevenlabs.calls)}
                </Typography.Text>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {projects.length > 0 ? (
        <div className="mt-4">
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Per story
          </Typography.Text>
          <div className="grid gap-2">
            {projects.map((entry) => (
              <div
                key={`${entry.projectId}-${entry.updatedAt}`}
                className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <Typography.Text strong style={{ display: "block" }}>
                  {entry.title || entry.projectId}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {entry.newsroom && !isNewsroomScope ? `${entry.newsroom.toUpperCase()} • ` : ""}
                  {entry.brandId ? `${entry.brandId} • ` : ""}
                  GPT {formatNumber(entry.totals.openai.calls)} • ElevenLabs{" "}
                  {formatNumber(entry.totals.elevenlabs.calls)}
                </Typography.Text>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
};

export default AIUsageDashboard;
