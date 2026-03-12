"use client";

import {
  getNewsroomBranding,
  getProjectConfig,
  saveNewsroomBranding,
  type NewsroomBrandingEntry,
} from "@/api";
import { useGlobalState } from "@/state/globalState";
import {
  App,
  Alert,
  Button,
  Collapse,
  Flex,
  Form,
  Input,
  InputNumber,
  Select,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useReactive } from "ahooks";
import { useEffect } from "react";

const { TextArea } = Input;

type FormShape = {
  domain?: string;
  image?: string;
  text?: string;
  logoMode?: "auto" | "image" | "text";
  logoStyle?: string;
  logoTextStyle?: string;
  disableIntro?: boolean;
  disableWipe?: boolean;
  disableOutro?: boolean;
  outroCard?: {
    duration?: number;
    backgroundColor?: string;
    backgroundImage?: string;
    logo?: string;
    logoScalePercent?: number;
    title?: string;
    body?: string;
  };
  playerJson?: string;
  guiColors?: {
    textBackground?: string;
    textColor?: string;
    progressActiveBackground?: string;
    progressActiveText?: string;
    progressInactiveBackground?: string;
    progressInactiveText?: string;
    mapMarker?: string;
    photoCreditsText?: string;
    photoCreditsIcon?: string;
  };
  guiProgress?: {
    placement?: "left" | "right";
    offsetX?: number;
    offsetYPortrait?: number;
    offsetYLandscape?: number;
    size?: number;
    gap?: number;
    shape?: "square" | "rounded" | "circle";
  };
};

type ColorFieldProps = {
  value?: string;
  onChange?: (value?: string) => void;
  placeholder?: string;
};

function normalizeColor(value: string | undefined): string {
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value || "")) {
    return value as string;
  }

  const cssVarFallback = value?.match(
    /var\([^,]+,\s*(#(?:[0-9a-f]{3}|[0-9a-f]{6}))\s*\)/i
  );
  if (cssVarFallback?.[1]) {
    return cssVarFallback[1];
  }

  const rgbMatch = value?.match(
    /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i
  );
  if (rgbMatch) {
    const [red, green, blue] = rgbMatch.slice(1, 4).map((channel) =>
      Math.max(0, Math.min(255, Number(channel)))
    );
    return `#${[red, green, blue]
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")}`;
  }

  return "#000000";
}

const ColorField = ({ value, onChange, placeholder }: ColorFieldProps) => {
  return (
    <Flex gap="small" align="center">
      <input
        type="color"
        value={normalizeColor(value)}
        onChange={(event) => onChange?.(event.target.value)}
        style={{
          width: 40,
          height: 32,
          padding: 0,
          border: "1px solid #d9d9d9",
          borderRadius: 6,
          background: "transparent",
        }}
      />
      <Input
        value={value}
        allowClear
        placeholder={placeholder}
        onChange={(event) => onChange?.(event.target.value || undefined)}
      />
    </Flex>
  );
};

function parseObjectJson(label: string, raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function setDeepValue(
  target: Record<string, unknown>,
  path: string[],
  value: string | undefined
): void {
  if (!value) {
    return;
  }

  let current: Record<string, unknown> = target;
  for (const key of path.slice(0, -1)) {
    const next = current[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }

  current[path[path.length - 1]] = value;
}

function getNestedString(source: Record<string, unknown>, path: string[]): string | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : undefined;
}

function getNestedNumber(source: Record<string, unknown>, path: string[]): number | undefined {
  let current: unknown = source;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "number" ? current : undefined;
}

function omitManagedPlayerFields(player: Record<string, unknown>): Record<string, unknown> {
  const next = { ...player };
  delete next.colors;
  delete next.outroCard;
  delete next.progress;
  return next;
}

function buildOutroCard(values: FormShape["outroCard"]): Record<string, unknown> | undefined {
  const duration = values?.duration;
  const backgroundColor = values?.backgroundColor?.trim();
  const backgroundImage = values?.backgroundImage?.trim();
  const logo = values?.logo?.trim();
  const logoScalePercent = values?.logoScalePercent;
  const title = values?.title?.trim();
  const body = values?.body?.trim();

  const hasContent = Boolean(backgroundColor || backgroundImage || logo || title || body);
  if (!hasContent) {
    return undefined;
  }

  return {
    duration: typeof duration === "number" && duration > 0 ? duration : 3,
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(backgroundImage ? { backgroundImage } : {}),
    ...(logo ? { logo } : {}),
    ...(typeof logoScalePercent === "number" && logoScalePercent > 0
      ? { logoScalePercent }
      : {}),
    ...(title ? { title } : {}),
    ...(body ? { body } : {}),
  };
}

function buildGuiColors(values: FormShape["guiColors"]): Record<string, unknown> | undefined {
  const colors: Record<string, unknown> = {};

  setDeepValue(colors, ["text", "background"], values?.textBackground);
  setDeepValue(colors, ["text", "text"], values?.textColor);
  setDeepValue(colors, ["progress", "active", "background"], values?.progressActiveBackground);
  setDeepValue(colors, ["progress", "active", "text"], values?.progressActiveText);
  setDeepValue(colors, ["progress", "inactive", "background"], values?.progressInactiveBackground);
  setDeepValue(colors, ["progress", "inactive", "text"], values?.progressInactiveText);
  setDeepValue(colors, ["map", "marker"], values?.mapMarker);
  setDeepValue(colors, ["fotoCredits", "text"], values?.photoCreditsText);
  setDeepValue(colors, ["fotoCredits", "icon"], values?.photoCreditsIcon);

  return Object.keys(colors).length > 0 ? colors : undefined;
}

function buildGuiProgress(
  values: FormShape["guiProgress"]
): Record<string, unknown> | undefined {
  const progress = {
    ...(values?.placement ? { placement: values.placement } : {}),
    ...(typeof values?.offsetX === "number" ? { offsetX: values.offsetX } : {}),
    ...(typeof values?.offsetYPortrait === "number"
      ? { offsetYPortrait: values.offsetYPortrait }
      : {}),
    ...(typeof values?.offsetYLandscape === "number"
      ? { offsetYLandscape: values.offsetYLandscape }
      : {}),
    ...(typeof values?.size === "number" ? { size: values.size } : {}),
    ...(typeof values?.gap === "number" ? { gap: values.gap } : {}),
    ...(values?.shape ? { shape: values.shape } : {}),
  };

  return Object.keys(progress).length > 0 ? progress : undefined;
}

function toFormValues(entry: NewsroomBrandingEntry): FormShape {
  const player = entry.player && typeof entry.player === "object" ? entry.player : {};
  const progress =
    player.progress && typeof player.progress === "object" && !Array.isArray(player.progress)
      ? (player.progress as Record<string, unknown>)
      : {};
  return {
    domain: entry.domain,
    image: entry.image,
    text: entry.text,
    logoMode: entry.logoMode,
    logoStyle: entry.logoStyle,
    logoTextStyle: entry.logoTextStyle,
    disableIntro: entry.disableIntro,
    disableWipe: entry.disableWipe,
    disableOutro: entry.disableOutro,
    outroCard: {
      duration:
        typeof player.outroCard === "object" &&
        player.outroCard &&
        "duration" in player.outroCard &&
        typeof player.outroCard.duration === "number"
          ? player.outroCard.duration
          : undefined,
      backgroundColor: getNestedString(player, ["outroCard", "backgroundColor"]),
      backgroundImage: getNestedString(player, ["outroCard", "backgroundImage"]),
      logo: getNestedString(player, ["outroCard", "logo"]),
      logoScalePercent:
        typeof player.outroCard === "object" &&
        player.outroCard &&
        "logoScalePercent" in player.outroCard &&
        typeof player.outroCard.logoScalePercent === "number"
          ? player.outroCard.logoScalePercent
          : undefined,
      title: getNestedString(player, ["outroCard", "title"]),
      body: getNestedString(player, ["outroCard", "body"]),
    },
    playerJson: JSON.stringify(omitManagedPlayerFields(player), null, 2),
    guiColors: {
      textBackground: getNestedString(player, ["colors", "text", "background"]),
      textColor: getNestedString(player, ["colors", "text", "text"]),
      progressActiveBackground: getNestedString(player, ["colors", "progress", "active", "background"]),
      progressActiveText: getNestedString(player, ["colors", "progress", "active", "text"]),
      progressInactiveBackground: getNestedString(player, ["colors", "progress", "inactive", "background"]),
      progressInactiveText: getNestedString(player, ["colors", "progress", "inactive", "text"]),
      mapMarker: getNestedString(player, ["colors", "map", "marker"]),
      photoCreditsText: getNestedString(player, ["colors", "fotoCredits", "text"]),
      photoCreditsIcon: getNestedString(player, ["colors", "fotoCredits", "icon"]),
    },
    guiProgress: {
      placement:
        progress.placement === "left" || progress.placement === "right"
          ? progress.placement
          : undefined,
      offsetX: getNestedNumber(player, ["progress", "offsetX"]),
      offsetYPortrait: getNestedNumber(player, ["progress", "offsetYPortrait"]),
      offsetYLandscape: getNestedNumber(player, ["progress", "offsetYLandscape"]),
      size: getNestedNumber(player, ["progress", "size"]),
      gap: getNestedNumber(player, ["progress", "gap"]),
      shape:
        progress.shape === "square" ||
        progress.shape === "rounded" ||
        progress.shape === "circle"
          ? progress.shape
          : undefined,
    },
  };
}

function sanitizeEntry(entry: NewsroomBrandingEntry): NewsroomBrandingEntry {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => {
      if (value === undefined) {
        return false;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value).length > 0;
      }
      return true;
    })
  ) as NewsroomBrandingEntry;
}

const NewsroomThemeEditor = () => {
  const { selectedProject, setConfig } = useGlobalState();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormShape>();
  const state = useReactive({
    loading: true,
    saving: false,
    newsroom: "" as string,
    error: null as string | null,
    success: null as string | null,
  });

  useEffect(() => {
    if (!selectedProject?.id) {
      state.loading = false;
      return;
    }

    let cancelled = false;

    const load = async () => {
      state.loading = true;
      state.error = null;
      state.success = null;
      try {
        const payload = await getNewsroomBranding(selectedProject.id);
        if (cancelled) {
          return;
        }
        state.newsroom = payload.newsroom || "";
        form.resetFields();
        form.setFieldsValue(toFormValues(payload.entry));
      } catch (error) {
        if (cancelled) {
          return;
        }
        state.error =
          error instanceof Error ? error.message : "Failed to load newsroom theme.";
      } finally {
        if (!cancelled) {
          state.loading = false;
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [form, selectedProject?.id, state]);

  if (!selectedProject?.id) {
    return null;
  }

  const handleSave = async () => {
    if (!state.newsroom) {
      state.error = "No newsroom was detected for this project.";
      return;
    }

    state.error = null;
    state.success = null;
    state.saving = true;

    try {
      const values = await form.validateFields();
      const advancedPlayer = parseObjectJson(
        "Advanced player overrides",
        values.playerJson || "{}"
      );
      const guiColors = buildGuiColors(values.guiColors);
      const guiProgress = buildGuiProgress(values.guiProgress);
      const outroCard = buildOutroCard(values.outroCard);
      const player = {
        ...advancedPlayer,
        ...(guiColors ? { colors: guiColors } : {}),
        ...(guiProgress ? { progress: guiProgress } : {}),
        ...(outroCard ? { outroCard } : {}),
      };

      const entry = sanitizeEntry({
        domain: values.domain?.trim(),
        image: values.image?.trim(),
        text: values.text?.trim(),
        logoMode: values.logoMode,
        logoStyle: values.logoStyle?.trim(),
        logoTextStyle: values.logoTextStyle?.trim(),
        disableIntro: values.disableIntro,
        disableWipe: values.disableWipe,
        disableOutro: values.disableOutro,
        player: Object.keys(player).length > 0 ? player : undefined,
      });

      await saveNewsroomBranding(state.newsroom, entry);
      const refreshedConfig = await getProjectConfig(selectedProject.id);
      setConfig(refreshedConfig);
      state.success = `Saved newsroom theme for ${state.newsroom}.`;
      message.success(state.success);
    } catch (error) {
      state.error =
        error instanceof Error ? error.message : "Failed to save newsroom theme.";
    } finally {
      state.saving = false;
    }
  };

  return state.loading ? (
    <Spin />
  ) : !state.newsroom ? (
    <Alert
      type="info"
      showIcon
      title="Ingen newsroom funnet"
      description="Denne editoren er tilgjengelig for prosjekter der et Polaris-newsroom kan identifiseres."
    />
  ) : (
    <Form form={form} layout="vertical">
      <Flex vertical gap="middle">
        <Alert
          type="info"
          showIcon
          title="Newsroom theme"
          description="Blanke felt arver fra brand/default. Lagre oppdaterer preview-configen for dette prosjektet."
        />
        <Flex gap="small" align="center" wrap="wrap">
          <Typography.Text strong>Newsroom:</Typography.Text>
          <Tag color="blue">{state.newsroom}</Tag>
        </Flex>

        {state.error ? <Alert type="error" showIcon title={state.error} /> : null}
        {state.success ? <Alert type="success" showIcon title={state.success} /> : null}

        <Collapse
          defaultActiveKey={["identity", "outro-card", "colors", "progress-layout", "advanced"]}
          items={[
            {
              key: "identity",
              label: "Logo & Visibility",
              children: (
                <Flex vertical gap="middle">
                  <Form.Item label="Domain" name="domain">
                    <Input placeholder="www.fvn.no" />
                  </Form.Item>
                  <Form.Item label="Logo image URL override" name="image">
                    <Input placeholder="https://..." />
                  </Form.Item>
                  <Form.Item label="Logo text override" name="text">
                    <Input placeholder="FVN" />
                  </Form.Item>
                  <Form.Item label="Logo rendering" name="logoMode">
                    <Select
                      allowClear
                      placeholder="Auto: prefer image, otherwise text"
                      options={[
                        { value: "auto", label: "Auto" },
                        { value: "image", label: "Image" },
                        { value: "text", label: "Text" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Logo style" name="logoStyle">
                    <TextArea rows={3} placeholder="position: absolute; ..." />
                  </Form.Item>
                  <Form.Item label="Logo text style" name="logoTextStyle">
                    <TextArea rows={3} placeholder="position: absolute; ..." />
                  </Form.Item>
                  <Flex gap="large" wrap="wrap">
                  <Form.Item
                      label="Intro"
                      name="disableIntro"
                    >
                      <Select
                        options={[
                          { value: true, label: "Disable" },
                          { value: false, label: "Enable" },
                        ]}
                        allowClear
                        placeholder="Inherit default"
                      />
                    </Form.Item>
                    <Form.Item
                      label="Wipe"
                      name="disableWipe"
                    >
                      <Select
                        options={[
                          { value: true, label: "Disable" },
                          { value: false, label: "Enable" },
                        ]}
                        allowClear
                        placeholder="Inherit default"
                      />
                    </Form.Item>
                    <Form.Item
                      label="Outro"
                      name="disableOutro"
                    >
                      <Select
                        options={[
                          { value: true, label: "Disable" },
                          { value: false, label: "Enable" },
                        ]}
                        allowClear
                        placeholder="Inherit default"
                      />
                    </Form.Item>
                  </Flex>
                </Flex>
              ),
            },
            {
              key: "outro-card",
              label: "Outro Card",
              children: (
                <Flex vertical gap="middle">
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    Optional end card shown after the story. Leave fields blank to disable it.
                  </Typography.Paragraph>
                  <Form.Item label="Duration (seconds)" name={["outroCard", "duration"]}>
                    <InputNumber min={1} max={20} step={0.5} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    label="Background color"
                    name={["outroCard", "backgroundColor"]}
                  >
                    <ColorField placeholder="#0b1220" />
                  </Form.Item>
                  <Form.Item
                    label="Background image URL"
                    name={["outroCard", "backgroundImage"]}
                  >
                    <Input placeholder="https://... or /api/brand-assets/..." />
                  </Form.Item>
                  <Form.Item label="Logo URL override" name={["outroCard", "logo"]}>
                    <Input placeholder="Optional. Uses newsroom logo if left blank." />
                  </Form.Item>
                  <Form.Item
                    label="Logo size (%)"
                    name={["outroCard", "logoScalePercent"]}
                  >
                    <InputNumber
                      min={25}
                      max={300}
                      step={5}
                      style={{ width: "100%" }}
                      placeholder="100"
                    />
                  </Form.Item>
                  <Form.Item label="Headline" name={["outroCard", "title"]}>
                    <Input placeholder="Les mer på fvn.no" />
                  </Form.Item>
                  <Form.Item label="Body text" name={["outroCard", "body"]}>
                    <TextArea
                      rows={4}
                      placeholder="Finn hele saken og mer journalistikk på fvn.no"
                    />
                  </Form.Item>
                </Flex>
              ),
            },
            {
              key: "colors",
              label: "Colors",
              children: (
                <Flex vertical gap="middle">
                  <Typography.Text strong>Captions</Typography.Text>
                  <Form.Item
                    label="Text background"
                    name={["guiColors", "textBackground"]}
                  >
                    <ColorField placeholder="#0051a8" />
                  </Form.Item>
                  <Form.Item label="Text color" name={["guiColors", "textColor"]}>
                    <ColorField placeholder="#ffffff" />
                  </Form.Item>

                  <Typography.Text strong>Progress</Typography.Text>
                  <Form.Item
                    label="Active background"
                    name={["guiColors", "progressActiveBackground"]}
                  >
                    <ColorField placeholder="#0051a8" />
                  </Form.Item>
                  <Form.Item
                    label="Active text"
                    name={["guiColors", "progressActiveText"]}
                  >
                    <ColorField placeholder="#ffffff" />
                  </Form.Item>
                  <Form.Item
                    label="Inactive background"
                    name={["guiColors", "progressInactiveBackground"]}
                  >
                    <ColorField placeholder="#000000" />
                  </Form.Item>
                  <Form.Item
                    label="Inactive text"
                    name={["guiColors", "progressInactiveText"]}
                  >
                    <ColorField placeholder="#ffffff" />
                  </Form.Item>

                  <Typography.Text strong>Map & Photo Credits</Typography.Text>
                  <Form.Item label="Map marker" name={["guiColors", "mapMarker"]}>
                    <ColorField placeholder="#dd0000" />
                  </Form.Item>
                  <Form.Item
                    label="Photo credits text"
                    name={["guiColors", "photoCreditsText"]}
                  >
                    <ColorField placeholder="#cacaca" />
                  </Form.Item>
                  <Form.Item
                    label="Photo credits icon"
                    name={["guiColors", "photoCreditsIcon"]}
                  >
                    <ColorField placeholder="#cacaca" />
                  </Form.Item>
                </Flex>
              ),
            },
            {
              key: "progress-layout",
              label: "Progress Layout",
              children: (
                <Flex vertical gap="middle">
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    Controls the numbered story markers shown alongside the video.
                  </Typography.Paragraph>
                  <Form.Item label="Placement" name={["guiProgress", "placement"]}>
                    <Select
                      allowClear
                      placeholder="Left side"
                      options={[
                        { value: "left", label: "Left" },
                        { value: "right", label: "Right" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item label="Horizontal offset (px)" name={["guiProgress", "offsetX"]}>
                    <InputNumber min={0} max={600} step={4} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    label="Top offset, portrait (px)"
                    name={["guiProgress", "offsetYPortrait"]}
                  >
                    <InputNumber min={0} max={1800} step={4} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    label="Top offset, landscape (px)"
                    name={["guiProgress", "offsetYLandscape"]}
                  >
                    <InputNumber min={0} max={1000} step={4} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="Indicator size (px)" name={["guiProgress", "size"]}>
                    <InputNumber min={24} max={240} step={2} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="Gap (px)" name={["guiProgress", "gap"]}>
                    <InputNumber min={0} max={80} step={2} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="Shape" name={["guiProgress", "shape"]}>
                    <Select
                      allowClear
                      placeholder="Rounded"
                      options={[
                        { value: "square", label: "Square" },
                        { value: "rounded", label: "Rounded" },
                        { value: "circle", label: "Circle" },
                      ]}
                    />
                  </Form.Item>
                </Flex>
              ),
            },
            {
              key: "advanced",
              label: "Advanced Player JSON",
              children: (
                <Flex vertical gap="small">
                  <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    Use this for fonts, styles, background music, custom cuts and other
                    `player` overrides. The color fields above are merged on top.
                  </Typography.Paragraph>
                  <Form.Item label="Player overrides" name="playerJson">
                    <TextArea
                      rows={16}
                      placeholder='{"fonts":{"headline":"/api/brand-assets/fonts/Newsroom.woff2"}}'
                    />
                  </Form.Item>
                </Flex>
              ),
            },
          ]}
        />

        <Button type="primary" onClick={handleSave} loading={state.saving}>
          Save newsroom theme
        </Button>
      </Flex>
    </Form>
  );
};

export default NewsroomThemeEditor;
