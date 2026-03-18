"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReactive } from "ahooks";
import { useGlobalState } from "@/state/globalState";
import { Config } from "@videofy/types";
import Cookies from "universal-cookie";
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
  Row,
  Select,
  Spin,
  Tag,
  Typography,
} from "antd";
import { useRouter } from "next/navigation";
import {
  getBrands,
  generateProjectManuscript,
  getPolarisNewsrooms,
  getProjectConfig,
  type PolarisNewsroomItem,
  runFetcherPlugin,
  saveProjectConfig,
  setProjectBrand,
  useBrands,
  useFetchers,
  useGenerations,
} from "@/api";
import { LoadingOutlined } from "@ant-design/icons";
import PolarisArticleAssist from "@/components/FetcherFields/PolarisArticleAssist";
import AIUsageDashboard from "@/components/AIUsageDashboard";
import NewsroomHomes from "@/components/StartPage/NewsroomHomes";
import {
  GENERATION_MODEL_OPTIONS,
  resolveGenerationModel,
  type GenerationModel,
} from "@/lib/openaiModels";
import {
  parseArticleRefInput,
  parseArticleRefsInput,
} from "@/lib/polarisArticleInputs";
import { randomId } from "@/lib/randomId";

const { Title, Paragraph } = Typography;
const cookies = new Cookies();

type FormType = {
  fetcherId: string;
  brandId: string;
  model: GenerationModel;
  prompt: string;
  inputs: Record<string, string | string[]>;
};

const DEFAULT_FETCHER_ID = "polaris-capi";
const PANEL_CARD_STYLE = {
  background: "rgba(255,255,255,0.94)",
  borderColor: "#dbe5f3",
  boxShadow: "0 14px 36px rgba(148, 163, 184, 0.14)",
} as const;

function normalizeNewsroom(value: string | undefined): string {
  return value?.trim().toLowerCase() || "";
}

function formatSessionDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("nb-NO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}

function getProfileStepTitle(
  showBrandControls: boolean,
  showPromptPresetOptions: boolean
): string {
  if (showBrandControls) {
    return "2. Velg profil";
  }

  if (showPromptPresetOptions) {
    return "2. Prompt";
  }

  return "2. Prompt";
}

function getProfileStepDescription(
  showBrandControls: boolean,
  showPromptPresetOptions: boolean
): string {
  if (showBrandControls) {
    return "Brand og prompt styrer manus, tone og visuell retning.";
  }

  if (showPromptPresetOptions) {
    return "Promptvalg styrer manus og tone i storyen.";
  }

  return "Prompt styrer manus og tone i storyen.";
}

const StartPage = ({ initialNewsroom }: { initialNewsroom?: string }) => {
  const { data: fetchers, isLoading: loadingFetchers } = useFetchers();
  const { data: brands, isLoading: loadingBrands } = useBrands();
  const { data: generations, isLoading: loadingGenerations } = useGenerations();
  const hasFetchers = Boolean(fetchers && fetchers.length > 0);
  const hasBrands = Boolean(brands && brands.length > 0);

  const state = useReactive({
    loading: false,
    loadingMessage: "Generating video...",
  });
  const { notification } = App.useApp();
  const {
    setConfig,
    setCustomPrompt,
    setTabs,
    setCurrentTabIndex,
    setGenerationId,
    setSelectedProject,
  } = useGlobalState();

  const [form] = Form.useForm<FormType>();
  const selectedFetcherId = Form.useWatch("fetcherId", form);
  const selectedBrandId = Form.useWatch("brandId", form);
  const selectedModel = Form.useWatch("model", form);
  const selectedPrompt = Form.useWatch("prompt", form) || "";
  const selectedArticleRef = Form.useWatch(["inputs", "article_ref"], form);
  const selectedArticleRefs = Form.useWatch(["inputs", "article_refs"], form);
  const selectedNewsroom = Form.useWatch(["inputs", "newsroom"], form);
  const [newsroomMeta, setNewsroomMeta] = useState<Record<string, PolarisNewsroomItem>>({});
  const normalizedInitialNewsroom = normalizeNewsroom(initialNewsroom);
  const normalizedSelectedNewsroom = normalizeNewsroom(
    typeof selectedNewsroom === "string" ? selectedNewsroom : undefined
  );
  const isNewsroomHome = normalizedInitialNewsroom.length > 0;
  const activeNewsroomKey = normalizedInitialNewsroom || normalizedSelectedNewsroom;
  const activeNewsroomDisplayName = activeNewsroomKey
    ? newsroomMeta[activeNewsroomKey]?.name || activeNewsroomKey.toUpperCase()
    : undefined;
  const selectedFetcher = useMemo(
    () =>
      fetchers?.find(
        (fetcher) =>
          fetcher.id === (selectedFetcherId || (isNewsroomHome ? DEFAULT_FETCHER_ID : undefined))
      ),
    [fetchers, isNewsroomHome, selectedFetcherId]
  );
  const selectedFetcherFields = useMemo(
    () =>
      (selectedFetcher?.fields || []).filter((field) => {
        if (field.name === "project_id") {
          return false;
        }

        if (selectedFetcher?.id === "polaris-capi" && field.name === "newsroom") {
          return false;
        }

        if (selectedFetcher?.id === "polaris-capi" && field.name === "article_ref") {
          return false;
        }

        return true;
      }),
    [selectedFetcher]
  );
  const selectedBrand = useMemo(
    () => brands?.find((brand) => brand.id === selectedBrandId),
    [brands, selectedBrandId]
  );
  const onlyDefaultBrand = useMemo(
    () => (brands?.length || 0) === 1 && brands?.[0]?.id === "default",
    [brands]
  );
  const showBrandControls = !onlyDefaultBrand;
  const recentGenerations = useMemo(() => {
    const items = generations || [];
    if (!isNewsroomHome || !activeNewsroomKey) {
      return items.slice(0, 5);
    }

    return items
      .filter((generation) => normalizeNewsroom(generation.newsroom) === activeNewsroomKey)
      .slice(0, 5);
  }, [activeNewsroomKey, generations, isNewsroomHome]);
  const promptPresetOptions = useMemo(() => {
    if (!selectedBrand) {
      return [];
    }

    const presets: Array<{
      id: string;
      label: string;
      prompt: string;
      description?: string;
    }> = [];
    if (selectedBrand.scriptPrompt.trim()) {
      presets.push({
        id: "__standard",
        label: "Standard",
        prompt: selectedBrand.scriptPrompt,
        description: `Standardprompt for ${selectedBrand.brandName}.`,
      });
    }

    return [
      ...presets,
      ...selectedBrand.promptOptions.filter((option) => option.prompt.trim().length > 0),
    ];
  }, [selectedBrand]);
  const activePromptPreset = useMemo(
    () => promptPresetOptions.find((option) => option.prompt === selectedPrompt),
    [promptPresetOptions, selectedPrompt]
  );
  const showPromptPresetOptions = promptPresetOptions.length > 1;
  const stepTwoTitle = useMemo(
    () => getProfileStepTitle(showBrandControls, showPromptPresetOptions),
    [showBrandControls, showPromptPresetOptions]
  );
  const stepTwoDescription = useMemo(
    () => getProfileStepDescription(showBrandControls, showPromptPresetOptions),
    [showBrandControls, showPromptPresetOptions]
  );
  const showPolarisArticleAssist =
    isNewsroomHome || selectedFetcher?.id === DEFAULT_FETCHER_ID;
  const selectedArticleCount = useMemo(
    () =>
      Array.isArray(selectedArticleRefs)
        ? selectedArticleRefs.filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0
          ).length
        : 0,
    [selectedArticleRefs]
  );
  const importSummary = useMemo(() => {
    if (selectedFetcher?.id !== "polaris-capi") {
      return selectedFetcher?.description || "Velg en fetcher og fyll inn feltene som kreves.";
    }

    const hasManualArticle =
      typeof selectedArticleRef === "string" && selectedArticleRef.trim().length > 0;

    if (selectedArticleCount > 0) {
      return `${selectedArticleCount} artikler valgt${activeNewsroomDisplayName ? ` fra ${activeNewsroomDisplayName}` : ""}.`;
    }

    if (hasManualArticle) {
      return "1 artikkel valgt via URL eller artikkel-ID.";
    }

    if (activeNewsroomDisplayName) {
      return `${activeNewsroomDisplayName} er valgt. Velg én eller flere artikler fra listen.`;
    }

    return "Velg newsroom og plukk artikler fra listen, eller lim inn en artikkel-URL.";
  }, [activeNewsroomDisplayName, selectedArticleCount, selectedArticleRef, selectedFetcher]);
  const promptSourceLabel = useMemo(() => {
    if (!selectedBrand) {
      return "Ikke valgt";
    }

    if (activePromptPreset) {
      return `${selectedBrand.brandName} / ${activePromptPreset.label}`;
    }

    if (selectedPrompt.trim().length > 0) {
      return promptPresetOptions.length > 0 ? "Custom" : selectedBrand.brandName;
    }

    return selectedBrand.brandName;
  }, [activePromptPreset, promptPresetOptions.length, selectedBrand, selectedPrompt]);
  const lastSyncedBrandId = useRef<string | undefined>(undefined);

  const router = useRouter();

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
        console.error("[start-page] Failed to load newsroom metadata", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!fetchers || fetchers.length === 0) {
      return;
    }
    const currentFetcherId = form.getFieldValue("fetcherId");
    if (currentFetcherId) {
      return;
    }
    const preferredFetcher =
      fetchers.find((fetcher) => fetcher.id === DEFAULT_FETCHER_ID) || fetchers[0];
    form.setFieldsValue({
      fetcherId: preferredFetcher.id,
      inputs: {},
    });
  }, [fetchers, form]);

  useEffect(() => {
    if (!brands || brands.length === 0) {
      return;
    }
    const currentBrandId = form.getFieldValue("brandId");
    if (currentBrandId) {
      return;
    }
    const initialBrand = brands[0];
    form.setFieldsValue({
      brandId: initialBrand.id,
      model: resolveGenerationModel(initialBrand.manuscriptModel, "gpt-4o"),
      prompt: initialBrand.scriptPrompt || "",
    });
  }, [brands, form]);

  useEffect(() => {
    if (!brands || brands.length === 0 || !selectedBrandId) {
      return;
    }
    if (lastSyncedBrandId.current === selectedBrandId) {
      return;
    }
    const selectedBrand = brands.find((brand) => brand.id === selectedBrandId);
    if (!selectedBrand) {
      return;
    }
    const nextPrompt = selectedBrand.scriptPrompt || "";
    const currentPrompt = form.getFieldValue("prompt") || "";
    if (nextPrompt !== currentPrompt) {
      form.setFields([{ name: "prompt", value: nextPrompt }]);
    }
    form.setFields([
      {
        name: "model",
        value: resolveGenerationModel(selectedBrand.manuscriptModel, "gpt-4o"),
      },
    ]);
    lastSyncedBrandId.current = selectedBrandId;
  }, [brands, form, selectedBrandId]);

  useEffect(() => {
    if (!selectedFetcherId) {
      return;
    }
    const currentInputs = form.getFieldValue("inputs") || {};
    if (selectedFetcherId === DEFAULT_FETCHER_ID) {
      form.setFieldValue("inputs", {
        newsroom:
          typeof currentInputs.newsroom === "string" && currentInputs.newsroom.trim().length > 0
            ? currentInputs.newsroom
            : undefined,
      });
      return;
    }
    form.setFieldValue("inputs", {});
  }, [selectedFetcherId, form]);

  useEffect(() => {
    if (!normalizedInitialNewsroom) {
      return;
    }

    const currentFetcherId = form.getFieldValue("fetcherId");
    const currentInputs = (form.getFieldValue("inputs") || {}) as Record<string, unknown>;
    const currentNewsroom =
      typeof currentInputs.newsroom === "string" ? currentInputs.newsroom.trim().toLowerCase() : "";

    if (currentFetcherId === DEFAULT_FETCHER_ID && currentNewsroom === normalizedInitialNewsroom) {
      return;
    }

    form.setFieldsValue({
      fetcherId: DEFAULT_FETCHER_ID,
      inputs: {
        ...currentInputs,
        newsroom: normalizedInitialNewsroom,
      },
    });
  }, [form, normalizedInitialNewsroom]);

  const handleSelectNewsroom = (newsroom: string) => {
    form.setFieldsValue({
      fetcherId: DEFAULT_FETCHER_ID,
      inputs: {
        newsroom,
      },
    });
  };

  const loadManuscript = async (values: FormType) => {
    const { prompt, model } = values;
    const fetcherId = values.fetcherId || (isNewsroomHome ? DEFAULT_FETCHER_ID : "");
    const brandId = values.brandId || brands?.[0]?.id || "";
    const customPrompt = (prompt || "").trim();
    const selected = fetchers?.find((fetcher) => fetcher.id === fetcherId);
    if (!selected) {
      notification.error({ title: "Fetcher not found." });
      return;
    }
    const brand =
      brands?.find((item) => item.id === brandId) ||
      (await getBrands()).find((item) => item.id === brandId);
    if (!brand) {
      notification.error({ title: "Brand not found." });
      return;
    }
    state.loading = true;
    state.loadingMessage = "Fetching article...";
    try {
      const rawInputs = values.inputs || {};
      const watchedArticleRefs = parseArticleRefsInput(selectedArticleRefs);
      const resolvedNewsroom =
        fetcherId === "polaris-capi"
          ? typeof rawInputs.newsroom === "string" && rawInputs.newsroom.trim().length > 0
            ? rawInputs.newsroom.trim()
            : isNewsroomHome
              ? normalizedInitialNewsroom
              : ""
          : "";
      const articleRefs =
        fetcherId === "polaris-capi"
          ? (() => {
              const fromSubmit = parseArticleRefsInput(rawInputs.article_refs);
              return fromSubmit.length > 0 ? fromSubmit : watchedArticleRefs;
            })()
          : [];
      const manualArticleRef =
        parseArticleRefInput(rawInputs.article_ref) || parseArticleRefInput(selectedArticleRef);

      if (fetcherId === "polaris-capi" && articleRefs.length === 0 && !manualArticleRef) {
        throw new Error("Select one or more articles, or paste a Polaris article URL.");
      }

      const fetchTargets =
        articleRefs.length > 0
          ? articleRefs
          : fetcherId === "polaris-capi" && manualArticleRef
            ? [manualArticleRef]
            : [undefined];

      const baseInputs = Object.entries(rawInputs).reduce<Record<string, string>>(
        (accumulator, [key, value]) => {
          if (
            key === "article_refs" ||
            key === "article_ref" ||
            typeof value !== "string" ||
            value.trim().length === 0
          ) {
            return accumulator;
          }

          accumulator[key] = value.trim();
          return accumulator;
        },
        {}
      );
      if (fetcherId === "polaris-capi" && resolvedNewsroom) {
        baseInputs.newsroom = resolvedNewsroom;
      }

      const tabsData: Array<{
        articleUrl: string;
        projectId: string;
        manuscript: Awaited<ReturnType<typeof generateProjectManuscript>>;
      }> = [];
      const failedTargets: string[] = [];
      const failureMessages: string[] = [];
      let primaryProject:
        | {
            id: string;
            name: string;
          }
        | undefined;
      let primaryConfigRow:
        | {
            projectId: string;
            config: Config;
          }
        | undefined;

      for (const [targetIndex, articleRef] of fetchTargets.entries()) {
        const fetchLabel = articleRef || selected.title || `article ${targetIndex + 1}`;
        state.loadingMessage = `Fetching ${targetIndex + 1}/${fetchTargets.length}...`;

        try {
          const fetchResult = await runFetcherPlugin({
            fetcherId,
            inputs: articleRef
              ? {
                  ...baseInputs,
                  article_ref: articleRef,
                }
              : baseInputs,
          });

          state.loadingMessage = `Applying brand ${targetIndex + 1}/${fetchTargets.length}...`;
          await setProjectBrand(fetchResult.projectId, brand.id);

          state.loadingMessage = `Loading config ${targetIndex + 1}/${fetchTargets.length}...`;
          const configRow = await getProjectConfig(fetchResult.projectId);
          const config = configRow?.config;
          if (!config) {
            throw new Error(`Config not found for project '${fetchResult.projectId}'`);
          }

          const customizedConfig: Config = {
            ...config,
            openai: {
              ...(config.openai || {}),
              manuscriptModel: model,
              mediaModel: model,
            },
            manuscript: {
              ...config.manuscript,
              script_prompt: customPrompt || config.manuscript.script_prompt,
            },
          };

          await saveProjectConfig(fetchResult.projectId, customizedConfig);

          if (!primaryProject) {
            primaryProject = {
              id: fetchResult.projectId,
              name: fetchResult.projectId,
            };
            primaryConfigRow = { ...configRow, config: customizedConfig };
          }

          state.loadingMessage = `Generating ${targetIndex + 1}/${fetchTargets.length}...`;
          const manuscript = await generateProjectManuscript(fetchResult.projectId);

          if (!manuscript) {
            throw new Error("Backend did not return a manuscript");
          }

          tabsData.push({
            articleUrl: fetchResult.projectId,
            projectId: fetchResult.projectId,
            manuscript: {
              ...manuscript,
              meta: {
                ...manuscript.meta,
                articleUrl: fetchResult.projectId,
                uniqueId: randomId(),
              },
            },
          });
        } catch (error) {
          console.error(`[start-page] Failed to fetch target '${fetchLabel}':`, error);
          failedTargets.push(fetchLabel);
          failureMessages.push(
            error instanceof Error ? `${fetchLabel}: ${error.message}` : fetchLabel
          );
        }
      }

      if (tabsData.length === 0 || !primaryProject || !primaryConfigRow) {
        throw new Error(
          failureMessages[0]
            ? `Failed to add the selected article(s). ${failureMessages[0]}`
            : "Failed to add the selected article(s)."
        );
      }

      setSelectedProject(primaryProject);
      setConfig(primaryConfigRow);
      setTabs(tabsData);
      setCustomPrompt(customPrompt);
      setCurrentTabIndex(0);

          const response = await fetch("/api/generations", {
            method: "POST",
            body: JSON.stringify({
              projectId: primaryProject.id,
              brandId: brand.id,
              project: primaryProject,
              data: tabsData,
            }),
      });
      if (!response.ok) {
        throw new Error("Failed to create generation");
      }
      const { id: generationId } = await response.json();

      setGenerationId(generationId);
      cookies.set("projectId", primaryProject.id);

      if (failedTargets.length > 0) {
        notification.warning({
          title: `Added ${tabsData.length} article(s), ${failedTargets.length} failed`,
          description: failedTargets.join(", "),
          duration: 0,
        });
      }

      router.push(`/${encodeURIComponent(generationId)}`);
    } catch (error) {
      if (error instanceof Error) {
        notification.error({ title: error.message, duration: 0 });
      } else {
        notification.error({ title: "Failed to fetch article", duration: 0 });
      }
    } finally {
      state.loading = false;
      state.loadingMessage = "Generating video...";
    }
  };

  if (loadingFetchers || loadingBrands) {
    return (
      <Spin description="Loading fetchers and brands..." fullscreen delay={500} />
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(73,128,255,0.18),_transparent_42%),linear-gradient(180deg,_#f8fbff_0%,_#eef4ff_48%,_#f8fafc_100%)]">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,_rgba(255,255,255,0.96)_0%,_rgba(242,247,255,0.98)_62%,_rgba(233,241,255,1)_100%)] p-6 shadow-[0_18px_50px_rgba(79,105,160,0.12)] sm:p-8">
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_320px] xl:items-end">
            <div>
              <Tag color="blue" style={{ marginBottom: 16 }}>
                {isNewsroomHome ? "Newsroom-hjem" : "Ny story først"}
              </Tag>
              <Title
                style={{
                  fontSize: 52,
                  lineHeight: 1.02,
                  marginBottom: 12,
                  marginTop: 0,
                  color: "#0f172a",
                }}
              >
                {isNewsroomHome
                  ? `Lag story for ${activeNewsroomDisplayName || normalizedInitialNewsroom.toUpperCase()}`
                  : "Lag en ny Videofy-story"}
              </Title>
              <Paragraph
                style={{
                  marginBottom: 0,
                  maxWidth: 760,
                  fontSize: 18,
                  color: "rgba(15,23,42,0.68)",
                }}
              >
                {isNewsroomHome
                  ? "Velg én eller flere artikler fra listen først. Deretter velger du brand og prompt og går rett til editoren."
                  : "Importer én eller flere artikler, velg brand og prompt, og gå rett videre til editoren. Eksisterende stories ligger lenger ned som sekundær inngang."}
              </Paragraph>
              {isNewsroomHome ? (
                <div className="mt-4">
                  <Button onClick={() => router.push("/")}>Tilbake til forsiden</Button>
                </div>
              ) : null}
              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {[
                  {
                    title: isNewsroomHome ? "1. Velg artikler" : "1. Velg kilde",
                    text: isNewsroomHome
                      ? "Artikkelvelgeren er primærinngangen for newsroom-hjemmet."
                      : "Polaris-artikkel er raskest for newsroom-basert arbeidsflyt.",
                  },
                  {
                    title: stepTwoTitle,
                    text: stepTwoDescription,
                  },
                  {
                    title: "3. Åpne editor",
                    text: "Storyen opprettes og lagres automatisk for senere revisjon.",
                  },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="rounded-2xl border border-slate-200 bg-white/80 p-4 backdrop-blur"
                  >
                    <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                      {item.title}
                    </Typography.Text>
                    <Typography.Text type="secondary">{item.text}</Typography.Text>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white/75 p-4">
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                  Valgt oppsett
                </Typography.Text>
                <Typography.Text strong style={{ display: "block" }}>
                  {selectedFetcher?.title || "Velg fetcher"}
                </Typography.Text>
                {showBrandControls ? (
                  <Typography.Text type="secondary">
                    {selectedBrand?.brandName || "Velg brand"} • {selectedBrandId || "Brand mangler"}
                  </Typography.Text>
                ) : null}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/75 p-4">
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                  Importstatus
                </Typography.Text>
                <Typography.Text strong>{importSummary}</Typography.Text>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/75 p-4">
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 6 }}>
                  Promptkilde
                </Typography.Text>
                <Typography.Text strong>{promptSourceLabel}</Typography.Text>
              </div>
            </div>
          </div>
        </section>

        {!isNewsroomHome ? (
          <section>
            <Flex justify="space-between" align="start" gap="middle" style={{ marginBottom: 16 }}>
              <div>
                <Title level={4} style={{ marginBottom: 4 }}>
                  Newsroom-hjem
                </Title>
                <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  Velg aktivt ett newsroom for å åpne et kompakt newsroom-hjem med siste saker,
                  relevante stories og usage. Dette holder forsiden kortere og bedre på mobil.
                </Paragraph>
              </div>
            </Flex>
            <NewsroomHomes
              generations={generations || []}
              selectedNewsroom={typeof selectedNewsroom === "string" ? selectedNewsroom : undefined}
              onSelectNewsroom={handleSelectNewsroom}
              onOpenGeneration={(generationId) => router.push(`/${encodeURIComponent(generationId)}`)}
              onOpenNewsroomHome={(newsroom) => router.push(`/${encodeURIComponent(newsroom)}`)}
            />
          </section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card style={{ width: "100%", ...PANEL_CARD_STYLE }}>
            {!hasFetchers && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                title="No fetchers found"
                description="Add fetchers under minimal/fetchers/<fetcherId>/fetcher.json, then refresh."
              />
            )}
            {!hasBrands && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                title="No brands found"
                description="Add brand json files under minimal/brands/, then refresh."
              />
            )}
            <Form form={form} onFinish={loadManuscript} layout="vertical">
              {isNewsroomHome ? (
                <Form.Item name="fetcherId" hidden>
                  <Input />
                </Form.Item>
              ) : null}
              <Form.Item name="model" hidden>
                <Input />
              </Form.Item>
              {!showBrandControls ? (
                <Form.Item name="brandId" hidden>
                  <Input />
                </Form.Item>
              ) : null}
              <Flex vertical gap="large">
                <div>
                  <Title level={4} style={{ marginBottom: 4 }}>
                    Ny story
                  </Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    {showBrandControls
                      ? "Sett opp import, brand og prompt. Når du trykker knappen nederst opprettes en ny story og editoren åpnes."
                      : "Sett opp import og prompt. Når du trykker knappen nederst opprettes en ny story og editoren åpnes."}
                  </Paragraph>
                </div>

                <div>
                  <Title level={5} style={{ marginBottom: 4 }}>
                    {isNewsroomHome ? "1. Velg artikler" : "1. Kilde og import"}
                  </Title>
                  <Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    {isNewsroomHome
                      ? `Start med artikkelvelgeren for ${activeNewsroomDisplayName || normalizedInitialNewsroom.toUpperCase()}. Dette er raskeste vei til en ny story.`
                      : "Velg fetcher først. For Polaris er newsroom + multiselect den raskeste veien inn."}
                  </Paragraph>
                  {isNewsroomHome ? null : (
                    <Row gutter={[16, 0]}>
                      <Col xs={24} md={12}>
                        <Form.Item name="fetcherId" label="Fetcher" rules={[{ required: true }]}>
                          <Select
                            showSearch
                            filterOption={(input, option) =>
                              (option?.label ?? "")
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                            disabled={!hasFetchers}
                            options={fetchers?.map((fetcher) => ({
                              value: fetcher.id,
                              label: fetcher.title,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  )}
                  {selectedFetcher?.description ? (
                    <Paragraph type="secondary" style={{ marginTop: -8, marginBottom: 16 }}>
                      {selectedFetcher.description}
                    </Paragraph>
                  ) : null}
                  {selectedFetcherFields.length > 0 ? (
                    <Row gutter={[16, 0]}>
                      {selectedFetcherFields.map((field) => (
                        <Col xs={24} md={12} key={field.name}>
                          <Form.Item
                            name={["inputs", field.name]}
                            label={field.label}
                            preserve={false}
                            rules={
                              field.required
                                ? [{ required: true, message: `${field.label} is required` }]
                                : undefined
                            }
                          >
                            <Input placeholder={field.placeholder} />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  ) : null}
                  {showPolarisArticleAssist ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <Typography.Text strong style={{ display: "block", marginBottom: 6 }}>
                        {isNewsroomHome
                          ? `${activeNewsroomDisplayName || normalizedInitialNewsroom.toUpperCase()}-artikler`
                          : "Polaris-import"}
                      </Typography.Text>
                      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
                        {isNewsroomHome
                          ? "Velg flere artikler samtidig fra dette newsroomet for å bygge storyen raskt."
                          : "Velg newsroom og flere artikler samtidig for å bygge en story raskt."}
                      </Typography.Text>
                      <PolarisArticleAssist
                        form={form}
                        lockedNewsroom={isNewsroomHome ? normalizedInitialNewsroom : undefined}
                        hideNewsroomSelect={isNewsroomHome}
                        helperText={
                          isNewsroomHome
                            ? "Velg artikler fra listen, eller lim inn en URL/ID fra samme newsroom."
                            : undefined
                        }
                      />
                    </div>
                  ) : null}
                </div>

                <Divider style={{ margin: 0 }} />

                <div>
                  <Title level={5} style={{ marginBottom: 4 }}>
                    {showBrandControls ? "2. Velg profil" : stepTwoTitle}
                  </Title>
                  <Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    {showBrandControls
                      ? "Brand styrer modellvalg og defaults. Prompten kan finjusteres før sessionen lages."
                      : stepTwoDescription}
                  </Paragraph>
                  {showBrandControls ? (
                    <Row gutter={[16, 0]}>
                      <Col xs={24} md={12}>
                        <Form.Item name="brandId" label="Brand" rules={[{ required: true }]}>
                          <Select
                            showSearch
                            filterOption={(input, option) =>
                              (option?.label ?? "")
                                .toLowerCase()
                                .includes(input.toLowerCase())
                            }
                            disabled={!hasBrands}
                            options={brands?.map((brand) => ({
                              value: brand.id,
                              label: brand.brandName,
                            }))}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  ) : null}
                  {showPromptPresetOptions ? (
                    <Form.Item label="Prompt presets" style={{ marginBottom: 12 }}>
                      <div className="flex flex-wrap gap-2">
                        {promptPresetOptions.map((option) => (
                          <Button
                            key={option.id}
                            type={activePromptPreset?.id === option.id ? "primary" : "default"}
                            onClick={() => {
                              form.setFields([{ name: "prompt", value: option.prompt }]);
                            }}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </Form.Item>
                  ) : null}
                  <Form.Item label="Custom prompt" name="prompt" style={{ marginBottom: 0 }}>
                    <Input.TextArea rows={10} />
                  </Form.Item>
                  <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                    Prompt source: {promptSourceLabel}
                  </Paragraph>
                </div>

                <Divider style={{ margin: 0 }} />

                <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,_rgba(59,130,246,0.10),_rgba(255,255,255,0.92))] p-5">
                  <Title level={5} style={{ marginBottom: 4 }}>
                    3. Opprett story
                  </Title>
                  <Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    Storyen lagres automatisk slik at du kan åpne den igjen senere og gjøre endringer.
                  </Paragraph>
                  {state.loading ? (
                    <Button
                      type="primary"
                      size="large"
                      icon={<LoadingOutlined spin />}
                      disabled
                      block
                    >
                      {state.loadingMessage}
                    </Button>
                  ) : (
                    <Button
                      htmlType="submit"
                      type="primary"
                      size="large"
                      disabled={!hasFetchers || !hasBrands}
                      block
                    >
                      Opprett story og åpne editor
                    </Button>
                  )}
                </div>
              </Flex>
            </Form>
          </Card>

          <Flex vertical gap="middle">
            <Card style={PANEL_CARD_STYLE}>
              <Title level={5} style={{ marginBottom: 12 }}>
                Innstillinger
              </Title>
              <Flex vertical gap="small">
                <div>
                  <Typography.Text type="secondary">OpenAI-modell</Typography.Text>
                  <Select
                    value={selectedModel}
                    options={GENERATION_MODEL_OPTIONS}
                    onChange={(value) => {
                      form.setFields([{ name: "model", value }]);
                    }}
                    style={{ marginTop: 6, width: "100%" }}
                  />
                </div>
                <div>
                  <Typography.Text type="secondary">Fetcher</Typography.Text>
                  <Typography.Text strong style={{ display: "block" }}>
                    {selectedFetcher?.title || "Ikke valgt"}
                  </Typography.Text>
                </div>
                {showBrandControls ? (
                  <div>
                    <Typography.Text type="secondary">Brand</Typography.Text>
                    <Typography.Text strong style={{ display: "block" }}>
                      {selectedBrand?.brandName || "Ikke valgt"}
                    </Typography.Text>
                  </div>
                ) : null}
                <div>
                  <Typography.Text type="secondary">Import</Typography.Text>
                  <Typography.Text strong style={{ display: "block" }}>
                    {importSummary}
                  </Typography.Text>
                </div>
              </Flex>
            </Card>

            <AIUsageDashboard newsroom={isNewsroomHome ? activeNewsroomKey : undefined} />

            <Card style={PANEL_CARD_STYLE}>
              <Title level={5} style={{ marginBottom: 12 }}>
                Tips
              </Title>
              <Flex vertical gap="small">
                <Typography.Text>
                  Start med Polaris + newsroom hvis du vil bygge en story raskt.
                </Typography.Text>
                <Typography.Text>
                  Velg flere artikler samtidig hvis storyen skal dekke flere saker.
                </Typography.Text>
                {showBrandControls ? (
                  <Typography.Text>
                    Bruk brand-promptene når redaksjonen har faste formater eller tone-of-voice.
                  </Typography.Text>
                ) : null}
              </Flex>
            </Card>
          </Flex>
        </div>

        <Card style={{ width: "100%", ...PANEL_CARD_STYLE }}>
          <Flex justify="space-between" align="start" gap="middle" style={{ marginBottom: 16 }}>
            <div>
              <Title level={5} style={{ marginBottom: 4 }}>
                {activeNewsroomDisplayName && isNewsroomHome
                  ? `Nylige stories fra ${activeNewsroomDisplayName}`
                  : "Nylige stories"}
              </Title>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {activeNewsroomDisplayName && isNewsroomHome
                  ? `Viser bare tidligere stories fra ${activeNewsroomDisplayName}.`
                  : "Sekundær inngang for å åpne noe du allerede har laget."}
              </Paragraph>
            </div>
            {loadingGenerations ? <Spin size="small" /> : null}
          </Flex>
          {recentGenerations.length > 0 ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {recentGenerations.map((generation) => (
                <div
                  key={generation.id}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                >
                  <Flex justify="space-between" align="start" gap="middle">
                    <Flex vertical gap={2}>
                      <Typography.Text strong>{generation.title}</Typography.Text>
                      <Typography.Text type="secondary">
                        {generation.articleCount} artikler • Oppdatert{" "}
                        {formatSessionDate(generation.updatedAt)}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {generation.projectId}
                      </Typography.Text>
                    </Flex>
                    <Button onClick={() => router.push(`/${encodeURIComponent(generation.id)}`)}>
                      Åpne
                    </Button>
                  </Flex>
                </div>
              ))}
            </div>
          ) : !loadingGenerations ? (
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {activeNewsroomDisplayName && isNewsroomHome
                ? `Ingen lagrede stories fra ${activeNewsroomDisplayName} ennå.`
                : "Ingen lagrede stories ennå."}
            </Paragraph>
          ) : null}
        </Card>
      </div>
    </div>
  );
};

export default StartPage;
