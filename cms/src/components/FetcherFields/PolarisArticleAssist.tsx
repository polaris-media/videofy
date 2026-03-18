"use client";

import {
  getPolarisArticles,
  getPolarisNewsrooms,
  type PolarisArticleItem,
  type PolarisNewsroomItem,
} from "@/api";
import { Alert, Button, Checkbox, Form, Input, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd/es/form";
import { useEffect, useMemo, useState } from "react";

type Props = {
  form: FormInstance;
  lockedNewsroom?: string;
  hideNewsroomSelect?: boolean;
  helperText?: string;
};

const PolarisArticleAssist = ({
  form,
  lockedNewsroom,
  hideNewsroomSelect = false,
  helperText,
}: Props) => {
  const newsroom = Form.useWatch(["inputs", "newsroom"], form);
  const articleRef = Form.useWatch(["inputs", "article_ref"], form);
  const articleRefs = Form.useWatch(["inputs", "article_refs"], form);
  const [items, setItems] = useState<PolarisArticleItem[]>([]);
  const [newsrooms, setNewsrooms] = useState<PolarisNewsroomItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newsroomsLoading, setNewsroomsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newsroomsError, setNewsroomsError] = useState<string | null>(null);
  const [loadedForNewsroom, setLoadedForNewsroom] = useState<string | null>(null);

  const normalizedLockedNewsroom = useMemo(
    () => (typeof lockedNewsroom === "string" ? lockedNewsroom.trim().toLowerCase() : ""),
    [lockedNewsroom]
  );
  const normalizedNewsroom = useMemo(
    () =>
      normalizedLockedNewsroom ||
      (typeof newsroom === "string" ? newsroom.trim().toLowerCase() : ""),
    [newsroom, normalizedLockedNewsroom]
  );
  const normalizedArticleRef = useMemo(
    () => (typeof articleRef === "string" ? articleRef.trim() : ""),
    [articleRef]
  );
  const normalizedArticleRefs = useMemo(
    () =>
      Array.isArray(articleRefs)
        ? articleRefs.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [],
    [articleRefs]
  );

  const newsroomOptions = useMemo(
    () =>
      newsrooms.map((item) => ({
        value: item.newsroom,
        label: `${item.name} (${item.newsroom})`,
        searchText: `${item.name} ${item.newsroom} ${item.domain} ${item.region ?? ""}`.toLowerCase(),
      })),
    [newsrooms]
  );

  useEffect(() => {
    if (!normalizedLockedNewsroom) {
      return;
    }

    const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, unknown>;
    if (currentInputs.newsroom === normalizedLockedNewsroom) {
      return;
    }

    form.setFieldsValue({
      inputs: {
        ...currentInputs,
        newsroom: normalizedLockedNewsroom,
      },
    });
  }, [form, normalizedLockedNewsroom]);

  useEffect(() => {
    setItems([]);
    setError(null);
    setLoadedForNewsroom(null);
    const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, unknown>;
    if (Array.isArray(currentInputs.article_refs) && currentInputs.article_refs.length > 0) {
      form.setFieldsValue({
        inputs: {
          ...currentInputs,
          article_refs: [],
        },
      });
    }
  }, [form, normalizedNewsroom]);

  useEffect(() => {
    let isMounted = true;

    const loadNewsrooms = async () => {
      setNewsroomsLoading(true);
      setNewsroomsError(null);
      try {
        const nextItems = await getPolarisNewsrooms();
        if (isMounted) {
          setNewsrooms(nextItems);
        }
      } catch (loadError) {
        if (isMounted) {
          setNewsroomsError(
            loadError instanceof Error
              ? loadError.message
              : "Kunne ikke hente newsroom-listen."
          );
        }
      } finally {
        if (isMounted) {
          setNewsroomsLoading(false);
        }
      }
    };

    void loadNewsrooms();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (normalizedLockedNewsroom) {
      return;
    }

    if (typeof articleRef !== "string" || !articleRef.startsWith("http")) {
      return;
    }

    if (newsrooms.length === 0) {
      return;
    }

    let hostname = "";
    try {
      hostname = new URL(articleRef).hostname.toLowerCase();
    } catch {
      return;
    }

    const match = newsrooms.find(
      (item) => hostname === item.domain || hostname.endsWith(`.${item.domain}`)
    );
    if (!match || match.newsroom === normalizedNewsroom) {
      return;
    }

    const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, string>;
    form.setFieldsValue({
      inputs: {
        ...currentInputs,
        newsroom: match.newsroom,
      },
    });
  }, [articleRef, form, newsrooms, normalizedNewsroom]);

  const loadArticles = async (newsroomToLoad = normalizedNewsroom) => {
    if (!newsroomToLoad) {
      setError("Fyll inn newsroom for å hente artikler.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const nextItems = await getPolarisArticles(newsroomToLoad);
      setItems(nextItems);
      setLoadedForNewsroom(newsroomToLoad);
      if (nextItems.length === 0) {
        setError("Ingen artikler ble funnet for dette newsroom-et.");
      }
    } catch (loadError) {
      setItems([]);
      setLoadedForNewsroom(null);
      setError(
        loadError instanceof Error ? loadError.message : "Kunne ikke hente artikkellisten."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!normalizedNewsroom) {
      return;
    }

    if (normalizedArticleRef) {
      return;
    }

    void loadArticles(normalizedNewsroom);
  }, [normalizedArticleRef, normalizedNewsroom]);

  const updateSelectedArticleRefs = (nextValue: string[]) => {
    const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, unknown>;
    form.setFieldsValue({
      inputs: {
        ...currentInputs,
        article_ref: "",
        article_refs: nextValue,
        newsroom: normalizedNewsroom,
      },
    });
    void form.validateFields([["inputs", "article_ref"]]).catch(() => undefined);
  };

  const toggleSelectedArticleRef = (articleId: string) => {
    const nextValue = normalizedArticleRefs.includes(articleId)
      ? normalizedArticleRefs.filter((value) => value !== articleId)
      : [...normalizedArticleRefs, articleId];
    updateSelectedArticleRefs(nextValue);
  };

  const setSelectedArticleRef = (articleId: string, checked: boolean) => {
    const nextValue = checked
      ? normalizedArticleRefs.includes(articleId)
        ? normalizedArticleRefs
        : [...normalizedArticleRefs, articleId]
      : normalizedArticleRefs.filter((value) => value !== articleId);
    updateSelectedArticleRefs(nextValue);
  };

  return (
    <Space orientation="vertical" size="small" style={{ display: "flex", marginBottom: 16 }}>
      {helperText || !hideNewsroomSelect ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {helperText ||
            "Velg newsroom og plukk en artikkel fra listen, eller lim inn URL."}
        </Typography.Paragraph>
      ) : null}
      {hideNewsroomSelect ? (
        <Form.Item name={["inputs", "newsroom"]} hidden>
          <Input />
        </Form.Item>
      ) : (
        <Form.Item label="Newsroom" name={["inputs", "newsroom"]} style={{ marginBottom: 0 }}>
          <Select
            showSearch
            allowClear
            loading={newsroomsLoading}
            placeholder="Velg Polaris-newsroom"
            options={newsroomOptions}
            filterOption={(input, option) =>
              String(option?.searchText || "").includes(input.toLowerCase())
            }
          />
        </Form.Item>
      )}
      {newsroomsError ? <Alert type="warning" showIcon title={newsroomsError} /> : null}
      <Space wrap>
        <Button onClick={() => void loadArticles()} loading={loading} disabled={!normalizedNewsroom}>
          Oppdater liste
        </Button>
        {!hideNewsroomSelect && loadedForNewsroom ? (
          <Typography.Text type="secondary">
            Viser artikler for <code>{loadedForNewsroom}</code>
          </Typography.Text>
        ) : null}
      </Space>
      {error ? <Alert type="info" showIcon title={error} /> : null}
      {items.length > 0 ? (
        hideNewsroomSelect ? (
          <Form.Item label="Artikler" style={{ marginBottom: 0 }}>
            <Form.Item name={["inputs", "article_refs"]} hidden>
              <Select mode="multiple" options={[]} />
            </Form.Item>
            <div className="max-h-[560px] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2">
              <div className="grid gap-2">
                {items.map((item) => {
                  const title = item.title?.trim() || item.id;
                  const isSelected = normalizedArticleRefs.includes(item.id);

                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSelectedArticleRef(item.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleSelectedArticleRef(item.id);
                        }
                      }}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition ${
                        isSelected
                          ? "border-blue-300 bg-blue-50"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        style={{ marginTop: 2 }}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                        onChange={(event) => {
                          setSelectedArticleRef(item.id, event.target.checked);
                        }}
                      />
                      <div className="min-w-0">
                        <Typography.Text strong style={{ display: "block" }}>
                          {title}
                        </Typography.Text>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Form.Item>
        ) : (
          <Form.Item
            label="Siste artikler"
            name={["inputs", "article_refs"]}
            style={{ marginBottom: 0 }}
          >
            <Select
              mode="multiple"
              showSearch
              placeholder="Velg en eller flere artikler fra listen"
              maxTagCount="responsive"
              filterOption={(input, option) =>
                (String(option?.label || "") + String(option?.value || ""))
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
              options={items.map((item) => ({
                value: item.id,
                label: item.title ? `${item.title} (${item.id})` : item.id,
              }))}
              onChange={(value) => {
                updateSelectedArticleRefs(value);
              }}
            />
          </Form.Item>
        )
      ) : null}
      <Form.Item
        label={hideNewsroomSelect ? "URL eller artikkel-ID" : "Artikkel-URL eller ID"}
        name={["inputs", "article_ref"]}
        style={{ marginBottom: 0 }}
        rules={[
          {
            validator: async (_, value) => {
              const hasManualRef = typeof value === "string" && value.trim().length > 0;
              const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, unknown>;
              const hasSelectedRefs =
                Array.isArray(currentInputs.article_refs) &&
                currentInputs.article_refs.some(
                  (item) => typeof item === "string" && item.trim().length > 0
                );

              if (hasManualRef || hasSelectedRefs) {
                return;
              }

              throw new Error("Velg minst én artikkel eller lim inn URL/ID");
            },
          },
        ]}
      >
        <Input
          placeholder="Lim inn artikkel-URL eller skriv inn én ID"
          onChange={() => {
            const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, unknown>;
            if (Array.isArray(currentInputs.article_refs) && currentInputs.article_refs.length > 0) {
              form.setFieldsValue({
                inputs: {
                  ...currentInputs,
                  article_refs: [],
                },
              });
            }
            void form.validateFields([["inputs", "article_ref"]]).catch(() => undefined);
          }}
        />
      </Form.Item>
    </Space>
  );
};

export default PolarisArticleAssist;
