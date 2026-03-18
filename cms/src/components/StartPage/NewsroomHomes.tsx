"use client";

import { Button, Card, Flex, Select, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  type GenerationSummary,
  getPolarisArticles,
  getPolarisNewsrooms,
  type PolarisArticleItem,
  type PolarisNewsroomItem,
  useAIUsage,
} from "@/api";

type Props = {
  generations: GenerationSummary[];
  selectedNewsroom?: string;
  onSelectNewsroom: (newsroom: string) => void;
  onOpenGeneration: (generationId: string) => void;
  onOpenNewsroomHome?: (newsroom: string) => void;
};

function normalizeNewsroom(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

function isAggregatePayload(
  value: unknown
): value is {
  groups: {
    newsrooms: Array<{
      key: string;
      label: string;
      projectCount: number;
      totals: {
        openai: { totalTokens: number; calls: number };
        elevenlabs: { calls: number };
      };
    }>;
  };
} {
  return Boolean(value && typeof value === "object" && "groups" in value);
}

const NewsroomHomes = ({
  generations,
  selectedNewsroom,
  onSelectNewsroom,
  onOpenGeneration,
  onOpenNewsroomHome,
}: Props) => {
  const { data: aiUsage, isLoading: loadingUsage } = useAIUsage();
  const [newsroomMeta, setNewsroomMeta] = useState<Record<string, PolarisNewsroomItem>>({});
  const [latestArticles, setLatestArticles] = useState<PolarisArticleItem[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const activeNewsroom = normalizeNewsroom(selectedNewsroom);

  useEffect(() => {
    let cancelled = false;

    void getPolarisNewsrooms()
      .then((items) => {
        if (cancelled) {
          return;
        }
        const next: Record<string, PolarisNewsroomItem> = {};
        items.forEach((item) => {
          next[item.newsroom.toLowerCase()] = item;
        });
        setNewsroomMeta(next);
      })
      .catch((error) => {
        console.error("[newsroom-homes] Failed to load newsroom metadata", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!activeNewsroom) {
      setLatestArticles([]);
      return;
    }

    setLoadingArticles(true);
    void getPolarisArticles(activeNewsroom)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setLatestArticles(items.slice(0, 4));
      })
      .catch((error) => {
        console.error("[newsroom-homes] Failed to load latest Polaris articles", error);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingArticles(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeNewsroom]);

  const usageByNewsroom = useMemo(() => {
    if (!isAggregatePayload(aiUsage)) {
      return {};
    }

    return Object.fromEntries(
      aiUsage.groups.newsrooms.map((group) => [
        group.key,
        group,
      ])
    );
  }, [aiUsage]);

  const availableNewsrooms = useMemo(() => {
    const fromSessions = generations
      .map((generation) => normalizeNewsroom(generation.newsroom))
      .filter((value): value is string => Boolean(value));
    const allKeys = Object.keys(newsroomMeta);
    const values = [...fromSessions, ...allKeys].filter(
      (value, index, all) => all.indexOf(value) === index
    );

    return values.sort((left, right) => {
      const leftName = newsroomMeta[left]?.name || left;
      const rightName = newsroomMeta[right]?.name || right;
      return leftName.localeCompare(rightName, "nb");
    });
  }, [generations, newsroomMeta]);

  const activeHome = useMemo(() => {
    if (!activeNewsroom) {
      return null;
    }

    const sessions = generations
      .filter((generation) => normalizeNewsroom(generation.newsroom) === activeNewsroom)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 3);
    const brands = sessions
      .map((session) => session.brandId)
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index);

    return {
      newsroom: activeNewsroom,
      meta: newsroomMeta[activeNewsroom],
      latest: latestArticles,
      sessions,
      brands,
      usage: usageByNewsroom[activeNewsroom],
    };
  }, [activeNewsroom, generations, latestArticles, newsroomMeta, usageByNewsroom]);

  return (
    <Card
      style={{
        background: "rgba(255,255,255,0.94)",
        borderColor: "#dbe5f3",
        boxShadow: "0 14px 36px rgba(148, 163, 184, 0.12)",
      }}
    >
      <Flex vertical gap="middle">
        <div>
          <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
            Velg newsroom
          </Typography.Text>
          <Select
            allowClear
            showSearch
            value={activeNewsroom}
            placeholder="Velg ett newsroom for å åpne newsroom-hjemmet"
            style={{ width: "100%" }}
            options={availableNewsrooms.map((newsroom) => ({
              value: newsroom,
              label: newsroomMeta[newsroom]?.name || newsroom.toUpperCase(),
            }))}
            onChange={(value) => {
              onSelectNewsroom(value || "");
            }}
            filterOption={(input, option) =>
              String(option?.label || "")
                .toLowerCase()
                .includes(input.toLowerCase())
            }
          />
        </div>

        {!activeHome ? (
          <Typography.Text type="secondary">
            Newsroom-hjemmet vises først når du aktivt velger ett newsroom. Da får du siste saker,
            AI-usage og relevante sessions samlet på ett sted.
          </Typography.Text>
        ) : (
          <>
            <Flex justify="space-between" align="start" gap="middle">
              <div>
                <Typography.Title level={4} style={{ marginBottom: 4 }}>
                  {activeHome.meta?.name || activeHome.newsroom.toUpperCase()}
                </Typography.Title>
                <Typography.Text type="secondary">
                  {activeHome.meta?.domain || activeHome.newsroom}
                </Typography.Text>
              </div>
              <Flex gap="small" wrap="wrap">
                {onOpenNewsroomHome ? (
                  <Button type="primary" onClick={() => onOpenNewsroomHome(activeHome.newsroom)}>
                    Åpne newsroom-hjem
                  </Button>
                ) : null}
                <Button onClick={() => onSelectNewsroom(activeHome.newsroom)}>
                  Bruk i import
                </Button>
              </Flex>
            </Flex>

            <Flex wrap="wrap" gap="small">
              <Tag>{activeHome.sessions.length} sessions</Tag>
              {activeHome.brands.map((brand) => (
                <Tag key={brand}>{brand}</Tag>
              ))}
            </Flex>

            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                Siste saker
              </Typography.Text>
              {loadingArticles && activeHome.latest.length === 0 ? (
                <Spin size="small" />
              ) : activeHome.latest.length > 0 ? (
                <div className="grid gap-2">
                  {activeHome.latest.map((article) => (
                    <Typography.Text key={`${activeHome.newsroom}-${article.id}`}>
                      {article.title || article.id}
                    </Typography.Text>
                  ))}
                </div>
              ) : (
                <Typography.Text type="secondary">
                  Ingen artikler hentet ennå.
                </Typography.Text>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <Typography.Text type="secondary">GPT-kall</Typography.Text>
                <Typography.Title level={4} style={{ margin: "4px 0 0" }}>
                  {activeHome.usage?.totals.openai.calls || 0}
                </Typography.Title>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <Typography.Text type="secondary">ElevenLabs-kall</Typography.Text>
                <Typography.Title level={4} style={{ margin: "4px 0 0" }}>
                  {activeHome.usage?.totals.elevenlabs.calls || 0}
                </Typography.Title>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <Typography.Text type="secondary">Totale tokens</Typography.Text>
                <Typography.Title level={4} style={{ margin: "4px 0 0" }}>
                  {loadingUsage ? "..." : activeHome.usage?.totals.openai.totalTokens || 0}
                </Typography.Title>
              </div>
            </div>

            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                Nylige sessions
              </Typography.Text>
              {activeHome.sessions.length > 0 ? (
                <div className="grid gap-2">
                  {activeHome.sessions.map((session) => (
                    <Button
                      key={session.id}
                      type="default"
                      block
                      onClick={() => onOpenGeneration(session.id)}
                    >
                      {session.title}
                    </Button>
                  ))}
                </div>
              ) : (
                <Typography.Text type="secondary">
                  Ingen sessions lagret for dette newsroomet ennå.
                </Typography.Text>
              )}
            </div>
          </>
        )}
      </Flex>
    </Card>
  );
};

export default NewsroomHomes;
