"use client";

import {
  getPolarisArticles,
  getPolarisNewsrooms,
  type PolarisArticleItem,
  type PolarisNewsroomItem,
} from "@/api";
import { Alert, Button, Form, Select, Space, Typography } from "antd";
import type { FormInstance } from "antd/es/form";
import { useEffect, useMemo, useState } from "react";

type Props = {
  form: FormInstance;
};

const PolarisArticleAssist = ({ form }: Props) => {
  const newsroom = Form.useWatch(["inputs", "newsroom"], form);
  const articleRef = Form.useWatch(["inputs", "article_ref"], form);
  const [items, setItems] = useState<PolarisArticleItem[]>([]);
  const [newsrooms, setNewsrooms] = useState<PolarisNewsroomItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newsroomsLoading, setNewsroomsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newsroomsError, setNewsroomsError] = useState<string | null>(null);
  const [loadedForNewsroom, setLoadedForNewsroom] = useState<string | null>(null);

  const normalizedNewsroom = useMemo(
    () => (typeof newsroom === "string" ? newsroom.trim().toLowerCase() : ""),
    [newsroom]
  );
  const normalizedArticleRef = useMemo(
    () => (typeof articleRef === "string" ? articleRef.trim() : ""),
    [articleRef]
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
    setItems([]);
    setError(null);
    setLoadedForNewsroom(null);
  }, [normalizedNewsroom]);

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

  const selectedArticleId =
    typeof articleRef === "string" && items.some((item) => item.id === articleRef)
      ? articleRef
      : undefined;

  return (
    <Space orientation="vertical" size="small" style={{ display: "flex", marginBottom: 16 }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Alternativ: velg newsroom og plukk en artikkel fra listen i stedet for å lime inn URL.
      </Typography.Paragraph>
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
      {newsroomsError ? <Alert type="warning" showIcon title={newsroomsError} /> : null}
      <Space wrap>
        <Button onClick={() => void loadArticles()} loading={loading} disabled={!normalizedNewsroom}>
          Oppdater artikkelliste
        </Button>
        {loadedForNewsroom ? (
          <Typography.Text type="secondary">
            Viser artikler for <code>{loadedForNewsroom}</code>
          </Typography.Text>
        ) : null}
      </Space>
      {error ? <Alert type="info" showIcon title={error} /> : null}
      {items.length > 0 ? (
        <Form.Item label="Siste artikler" style={{ marginBottom: 0 }}>
          <Select
            showSearch
            placeholder="Velg artikkel fra listen"
            value={selectedArticleId}
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
              const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, string>;
              form.setFieldsValue({
                inputs: {
                  ...currentInputs,
                  article_ref: value,
                  newsroom: normalizedNewsroom,
                },
              });
            }}
          />
        </Form.Item>
      ) : null}
    </Space>
  );
};

export default PolarisArticleAssist;
