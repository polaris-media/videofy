"use client";

import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Divider,
  Flex,
  Form,
  Input,
  Modal,
  Row,
  Switch,
  Tag,
  Typography,
} from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { type FC, useMemo } from "react";
import { useReactive } from "ahooks";
import { useGlobalState } from "@/state/globalState";
import { logAIData } from "@/actions/logAIData";

const videoTypes = [
  {
    name: "Vertical",
    title: "Vertical",
    description: "1080x1920 video export",
    badge: "9:16",
  },
  {
    name: "Horizontal",
    title: "Horizontal",
    description: "1920x1080 video export",
    badge: "16:9",
  },
  {
    name: "Both",
    title: "Both formats",
    description: "Render 9:16 and 16:9 in one run",
    badge: "2 outputs",
  },
  {
    name: "Sound only",
    title: "Narration audio",
    description: "MP3 export only",
    badge: "Audio",
  },
  {
    name: "Videofy Project",
    title: "Project file",
    description: "Download the project as JSON",
    badge: "JSON",
  },
];

interface Props {
  open: boolean;
  setOpen: (open: boolean) => void;
}

type FormType = {
  exportType: string;
  logo: boolean;
  audio: boolean;
  voice: boolean;
  music: boolean;
  title: string;
};

const DownloadModal: FC<Props> = ({ open, setOpen }) => {
  const { tabs, processedManuscripts, generationId } = useGlobalState();
  const {
    config: { config },
  } = useGlobalState();
  const { notification } = App.useApp();
  const [downloadForm] = Form.useForm<FormType>();

  const state = useReactive({
    isProcessing: false,
    downloads: [] as Array<{ orientation: "vertical" | "horizontal"; downloadUrl: string }>,
    error: undefined as string | undefined,
  });

  const hasNarrationAudio = useMemo(
    () =>
      processedManuscripts.length > 0 &&
      processedManuscripts.every((manuscript) => Boolean(manuscript.meta.audio?.src)),
    [processedManuscripts]
  );

  const playerConfig = useMemo(
    () => ({
      ...(config.player || {}),
      assetBaseUrl:
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_CMS_BASE_URL || "http://127.0.0.1:3000",
    }),
    [config.player]
  );

  if (!config) return <div>Error: No config detected.</div>;

  const defaultExportType =
    config.exportDefaults?.exportType &&
    videoTypes.some((t) => t.name === config.exportDefaults?.exportType)
      ? config.exportDefaults.exportType
      : videoTypes[0]?.name;

  const defaultAudioEnabled =
    config.exportDefaults?.audio !== undefined ? config.exportDefaults.audio : true;

  const selectedExportType =
    Form.useWatch("exportType", downloadForm) || defaultExportType;
  const watchedAudio = Form.useWatch("audio", downloadForm);
  const audioEnabled = watchedAudio ?? defaultAudioEnabled;
  const isRenderableExport =
    selectedExportType !== "Videofy Project" && selectedExportType !== "Sound only";

  const downloadAsJsonProject = (title: string) => {
    const data = {
      config,
      manuscripts: tabs.map(({ manuscript }) => manuscript),
      articleUrls: tabs.map(({ articleUrl }) => articleUrl),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const currentTime = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `${title || "videofy-project"}-${currentTime}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const downloadAudio = (title: string) => {
    const firstAudioSrc = processedManuscripts[0]?.meta.audio?.src;
    if (!firstAudioSrc) {
      throw new Error("No narration audio found. Process manuscript first.");
    }

    const a = document.createElement("a");
    a.href = firstAudioSrc;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.download = `${title || "narration"}.mp3`;
    a.click();
  };

  const renderLocally = async (values: FormType) => {
    state.error = undefined;
    state.isProcessing = true;
    state.downloads = [];

    const orientations =
      values.exportType === "Both"
        ? (["vertical", "horizontal"] as const)
        : values.exportType === "Horizontal"
          ? (["horizontal"] as const)
          : (["vertical"] as const);

    try {
      const response = await fetch("/api/render/local", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId: generationId,
          orientations,
          manuscripts: processedManuscripts,
          playerConfig,
          voice: values.audio ? values.voice : false,
          backgroundMusic: values.audio ? values.music : false,
          disabledLogo: !values.logo,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Render failed (${response.status}): ${body}`);
      }

      const payload = (await response.json()) as {
        downloadUrl?: string;
        downloads?: Array<{ orientation: "vertical" | "horizontal"; downloadUrl: string }>;
      };

      if (!payload.downloads?.length && !payload.downloadUrl) {
        throw new Error("Render finished but no download URL was returned.");
      }

      state.downloads =
        payload.downloads?.length
          ? payload.downloads
          : [
              {
                orientation: orientations[0],
                downloadUrl: payload.downloadUrl!,
              },
            ];
    } finally {
      state.isProcessing = false;
    }
  };

  const handleDownload = async (values: FormType) => {
    try {
      if (values.exportType === "Videofy Project") {
        downloadAsJsonProject(values.title);
        return;
      }

      if (values.exportType === "Sound only") {
        downloadAudio(values.title);
        return;
      }

      await renderLocally(values);

      if (tabs.length > 0 && generationId) {
        await logAIData(processedManuscripts, generationId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      state.error = message;
      notification.error({
        title: "Download failed",
        description: message,
        duration: 0,
      });
    }
  };

  const primaryButtonText = (() => {
    if (selectedExportType === "Videofy Project") {
      return "Download project";
    }
    if (selectedExportType === "Sound only") {
      return "Download audio";
    }
    if (state.isProcessing) {
      return "Rendering locally...";
    }
    if (selectedExportType === "Both") {
      return state.downloads.length > 0 ? "Render again" : "Render both formats";
    }
    return state.downloads.length > 0 ? "Render again" : "Render video";
  })();

  return (
    <Modal open={open} onCancel={() => setOpen(false)} footer={null} width={720}>
      <Typography.Title level={2} style={{ marginBottom: 8 }}>
        Download
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 24 }}>
        Choose the export you want, tune the render settings, and then download the finished files.
      </Typography.Paragraph>

      <Form<FormType>
        form={downloadForm}
        onFinish={handleDownload}
        layout="vertical"
        initialValues={{
          title: processedManuscripts[0]?.meta.title || "videofy",
          exportType: defaultExportType,
          logo:
            config.exportDefaults?.logo !== undefined
              ? config.exportDefaults.logo
              : true,
          audio: defaultAudioEnabled,
          voice:
            hasNarrationAudio &&
            (config.exportDefaults?.voice !== undefined
              ? config.exportDefaults.voice
              : true),
          music:
            config.exportDefaults?.music !== undefined
              ? config.exportDefaults.music
              : true,
        }}
      >
        <Form.Item label="Export type" style={{ marginBottom: 20 }}>
          <div className="grid gap-3">
            {videoTypes.map((option) => {
              const isSelected = selectedExportType === option.name;
              return (
                <button
                  key={option.name}
                  type="button"
                  onClick={() => {
                    downloadForm.setFieldValue("exportType", option.name);
                    state.downloads = [];
                    state.error = undefined;
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    borderRadius: 14,
                    border: isSelected ? "1px solid #6d5efc" : "1px solid rgba(255,255,255,0.12)",
                    background: isSelected
                      ? "linear-gradient(180deg, rgba(109,94,252,0.22), rgba(109,94,252,0.10))"
                      : "rgba(255,255,255,0.03)",
                    padding: "14px 16px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <Flex justify="space-between" align="start" gap="middle">
                    <div>
                      <Typography.Text strong style={{ fontSize: 16 }}>
                        {option.title}
                      </Typography.Text>
                      <div>
                        <Typography.Text type="secondary">
                          {option.description}
                        </Typography.Text>
                      </div>
                    </div>
                    <Tag color={isSelected ? "processing" : "default"} style={{ marginInlineEnd: 0 }}>
                      {option.badge}
                    </Tag>
                  </Flex>
                </button>
              );
            })}
          </div>
        </Form.Item>

        <Card
          size="small"
          style={{
            marginBottom: 20,
            borderRadius: 16,
            background: "rgba(255,255,255,0.03)",
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Form.Item label="Title" name="title" style={{ marginBottom: isRenderableExport ? 20 : 0 }}>
            <Input className="w-full" />
          </Form.Item>

          {isRenderableExport ? (
            <>
              {!hasNarrationAudio && (
                <Alert
                  showIcon
                  type="info"
                  title="Voiceover er ikke tilgjengelig"
                  description="Prosjektet er prosessert uten ElevenLabs. Preview og render kan fortsatt kjøres uten voiceover."
                  style={{ marginBottom: 16 }}
                />
              )}

              <Typography.Text strong style={{ display: "block", marginBottom: 12 }}>
                Render settings
              </Typography.Text>

              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}>
                  <Card size="small">
                    <Flex justify="space-between" align="center" gap="small">
                      <Typography.Text>Logo</Typography.Text>
                      <Form.Item name="logo" valuePropName="checked" noStyle>
                        <Switch />
                      </Form.Item>
                    </Flex>
                  </Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small">
                    <Flex justify="space-between" align="center" gap="small">
                      <Typography.Text>Audio</Typography.Text>
                      <Form.Item name="audio" valuePropName="checked" noStyle>
                        <Switch />
                      </Form.Item>
                    </Flex>
                  </Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small">
                    <Flex justify="space-between" align="center" gap="small">
                      <Typography.Text
                        type={!audioEnabled || !hasNarrationAudio ? "secondary" : undefined}
                      >
                        Voiceover
                      </Typography.Text>
                      <Form.Item name="voice" valuePropName="checked" noStyle>
                        <Switch disabled={!audioEnabled || !hasNarrationAudio} />
                      </Form.Item>
                    </Flex>
                  </Card>
                </Col>
                <Col xs={12} md={6}>
                  <Card size="small">
                    <Flex justify="space-between" align="center" gap="small">
                      <Typography.Text type={!audioEnabled ? "secondary" : undefined}>
                        Music
                      </Typography.Text>
                      <Form.Item name="music" valuePropName="checked" noStyle>
                        <Switch disabled={!audioEnabled} />
                      </Form.Item>
                    </Flex>
                  </Card>
                </Col>
              </Row>
            </>
          ) : null}
        </Card>

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          block
          disabled={state.isProcessing}
          icon={state.isProcessing ? <LoadingOutlined spin /> : undefined}
          style={{ height: 48 }}
        >
          {primaryButtonText}
        </Button>

        {state.downloads.length > 0 ? (
          <>
            <Divider />
            <Card
              size="small"
              title="Ready files"
              style={{
                borderRadius: 16,
                background: "rgba(255,255,255,0.03)",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <div className="grid gap-3">
                {state.downloads.map((download) => (
                  <Button
                    key={download.orientation}
                    href={download.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    type="default"
                    size="large"
                    block
                    style={{ height: 46 }}
                  >
                    {download.orientation === "vertical"
                      ? "Download 9:16 video"
                      : "Download 16:9 video"}
                  </Button>
                ))}
              </div>
            </Card>
          </>
        ) : null}

        {state.error ? (
          <Alert type="error" title={`Error: ${state.error}`} style={{ marginTop: 16 }} />
        ) : null}
      </Form>
    </Modal>
  );
};

export default DownloadModal;
