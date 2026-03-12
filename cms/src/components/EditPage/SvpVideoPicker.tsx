"use client";

import {
  getPolarisNewsrooms,
  getSvpVideoByAssetId,
  getSvpVideos,
  importSvpVideo,
  type PolarisNewsroomItem,
  type SvpVideoItem,
} from "@/api";
import { inferPolarisNewsroomFromProjectId, resolveSvpProvider } from "@/lib/svp";
import { VideoType } from "@videofy/types";
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";

type Props = {
  projectId?: string;
  onSelect: (video: VideoType) => void | Promise<void>;
};

function formatDuration(durationMs: number | null | undefined): string {
  if (!durationMs || durationMs <= 0) {
    return "Unknown length";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPublished(published: number | null | undefined): string | null {
  if (!published) {
    return null;
  }

  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(published * 1000));
}

function isPlayableVideo(item: SvpVideoItem): boolean {
  return Boolean(item.playableUrl);
}

const SvpVideoPicker = ({ projectId, onSelect }: Props) => {
  const inferredNewsroom = useMemo(
    () => inferPolarisNewsroomFromProjectId(projectId),
    [projectId]
  );
  const [newsroom, setNewsroom] = useState<string | undefined>(inferredNewsroom);
  const [newsrooms, setNewsrooms] = useState<PolarisNewsroomItem[]>([]);
  const [items, setItems] = useState<SvpVideoItem[]>([]);
  const [assetId, setAssetId] = useState("");
  const [filterText, setFilterText] = useState("");
  const [newsroomsLoading, setNewsroomsLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [assetLoading, setAssetLoading] = useState(false);
  const [newsroomsError, setNewsroomsError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadedProvider, setLoadedProvider] = useState<string | null>(null);
  const [loadedNewsroom, setLoadedNewsroom] = useState<string | null>(null);
  const [importingAssetId, setImportingAssetId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadNewsrooms = async () => {
      setNewsroomsLoading(true);
      setNewsroomsError(null);

      try {
        const response = await getPolarisNewsrooms();
        if (!active) {
          return;
        }

        setNewsrooms(response);

        if (inferredNewsroom && response.some((item) => item.newsroom === inferredNewsroom)) {
          setNewsroom((current) => current || inferredNewsroom);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        setNewsroomsError(
          error instanceof Error ? error.message : "Could not load Polaris newsrooms"
        );
      } finally {
        if (active) {
          setNewsroomsLoading(false);
        }
      }
    };

    void loadNewsrooms();

    return () => {
      active = false;
    };
  }, [inferredNewsroom]);

  const newsroomOptions = useMemo(
    () =>
      newsrooms.map((item) => ({
        value: item.newsroom,
        label: `${item.name} (${item.newsroom})`,
        searchText: `${item.name} ${item.newsroom} ${item.domain}`.toLowerCase(),
      })),
    [newsrooms]
  );

  const visibleItems = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) {
      return items;
    }

    return items.filter((item) =>
      [item.title, item.description, item.id, item.categoryTitle, item.provider]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [filterText, items]);

  const loadLatestVideos = async (requestedNewsroom = newsroom) => {
    if (!requestedNewsroom) {
      setListError("Select a newsroom to load Stream videos.");
      return;
    }

    setListLoading(true);
    setListError(null);

    try {
      const response = await getSvpVideos(requestedNewsroom);
      setItems(response.items);
      setLoadedProvider(response.provider);
      setLoadedNewsroom(response.newsroom);
      if (response.items.length === 0) {
        setListError("No Stream videos were returned for this newsroom.");
      }
    } catch (error) {
      setItems([]);
      setLoadedProvider(null);
      setLoadedNewsroom(null);
      setListError(error instanceof Error ? error.message : "Could not load Stream videos.");
    } finally {
      setListLoading(false);
    }
  };

  const handleLookupAsset = async () => {
    if (!newsroom) {
      setListError("Select a newsroom before looking up a Stream asset.");
      return;
    }

    const normalizedAssetId = assetId.trim();
    if (!normalizedAssetId) {
      setListError("Enter a Stream asset ID.");
      return;
    }

    setAssetLoading(true);
    setListError(null);

    try {
      const response = await getSvpVideoByAssetId(newsroom, normalizedAssetId);
      setLoadedProvider(response.provider);
      setLoadedNewsroom(response.newsroom);
      setItems((current) => {
        const nextItems = [response.item, ...current.filter((item) => item.id !== response.item.id)];
        return nextItems;
      });
      setFilterText(normalizedAssetId);
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Could not load Stream asset.");
    } finally {
      setAssetLoading(false);
    }
  };

  useEffect(() => {
    if (!newsroom) {
      return;
    }

    if (items.length > 0 && loadedNewsroom === newsroom) {
      return;
    }

    void loadLatestVideos(newsroom);
  }, [items.length, loadedNewsroom, newsroom]);

  const handleUseVideo = async (item: SvpVideoItem) => {
    if (!projectId) {
      setListError("A project must exist before you can import a Stream video.");
      return;
    }

    if (!item.playableUrl) {
      setListError(`Stream asset ${item.id} does not expose a direct MP4 stream.`);
      return;
    }

    setImportingAssetId(item.id);
    setListError(null);

    try {
      const importedVideo = await importSvpVideo(projectId, item);
      await onSelect(importedVideo);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Could not import Stream video."
      );
    } finally {
      setImportingAssetId(null);
    }
  };

  return (
    <Space orientation="vertical" size="middle" style={{ display: "flex" }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        Browse recent Stream videos for the newsroom, or look up a specific asset ID.
      </Typography.Paragraph>

      <Form layout="vertical">
        <Form.Item label="Newsroom" style={{ marginBottom: 12 }}>
          <Select
            showSearch
            allowClear
            value={newsroom}
            loading={newsroomsLoading}
            placeholder="Select Polaris newsroom"
            options={newsroomOptions}
            filterOption={(input, option) =>
              String(option?.searchText || "").includes(input.toLowerCase())
            }
            onChange={(value) => {
              setNewsroom(value);
              setItems([]);
              setLoadedProvider(null);
              setLoadedNewsroom(null);
              setListError(null);
            }}
          />
        </Form.Item>
      </Form>

      {newsroomsError ? <Alert type="warning" showIcon title={newsroomsError} /> : null}

      <Flex gap="small" wrap="wrap" align="center">
        <Button type="default" onClick={() => void loadLatestVideos()} loading={listLoading}>
          Load latest videos
        </Button>
        {newsroom ? (
          <Typography.Text type="secondary">
            SVP provider: <code>{resolveSvpProvider(newsroom) || newsroom}</code>
          </Typography.Text>
        ) : null}
        {loadedProvider ? (
          <Typography.Text type="secondary">
            Loaded from <code>{loadedProvider}</code>
          </Typography.Text>
        ) : null}
      </Flex>

      <Space.Compact style={{ width: "100%" }}>
        <Input
          value={assetId}
          placeholder="Look up Stream asset ID"
          onChange={(event) => setAssetId(event.target.value)}
          onPressEnter={() => void handleLookupAsset()}
        />
        <Button onClick={() => void handleLookupAsset()} loading={assetLoading}>
          Add by ID
        </Button>
      </Space.Compact>

      <Input
        value={filterText}
        placeholder="Filter loaded videos by title"
        onChange={(event) => setFilterText(event.target.value)}
      />

      {listError ? <Alert type="info" showIcon title={listError} /> : null}

      {visibleItems.length === 0 && !listLoading ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No Stream videos loaded for the current filter."
        />
      ) : null}

      {visibleItems.length > 0 ? (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          }}
        >
          {visibleItems.map((item) => {
            const playable = isPlayableVideo(item);
            const published = formatPublished(item.published);
            const isImporting = importingAssetId === item.id;

            return (
              <Card
                key={item.id}
                hoverable
                cover={
                  item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="h-44 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-44 items-center justify-center bg-gray-100 text-gray-500">
                      No thumbnail
                    </div>
                  )
                }
                actions={[
                  <Button
                    key="select"
                    type="primary"
                    disabled={!playable}
                    loading={isImporting}
                    onClick={() => void handleUseVideo(item)}
                  >
                    Import video
                  </Button>,
                ]}
              >
                <Space orientation="vertical" size="small" style={{ display: "flex" }}>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  {item.description ? (
                    <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
                      {item.description}
                    </Typography.Paragraph>
                  ) : null}
                  <Flex gap="small" wrap="wrap">
                    <Tag>{formatDuration(item.duration)}</Tag>
                    {item.categoryTitle ? <Tag>{item.categoryTitle}</Tag> : null}
                    {published ? <Tag>{published}</Tag> : null}
                    {!playable ? <Tag color="warning">No direct MP4</Tag> : null}
                  </Flex>
                  <Typography.Text type="secondary">
                    Asset ID: <code>{item.id}</code>
                  </Typography.Text>
                </Space>
              </Card>
            );
          })}
        </div>
      ) : null}
    </Space>
  );
};

export default SvpVideoPicker;
