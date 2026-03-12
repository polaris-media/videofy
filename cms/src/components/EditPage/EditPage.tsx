"use client";

import { type FC, useEffect } from "react";
import { useReactive } from "ahooks";
import { useParams } from "next/navigation";
import { Tab, useGlobalState } from "@/state/globalState";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Flex, Form, Spin, Tooltip, Typography } from "antd";
import {
  ClearOutlined,
  CloseOutlined,
  SettingOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import PreviewOutput from "./Preview/PreviewOutput";
import SortableTabs from "../SortableTabs";
import SegmentList from "./SegmentList";
import EditConfig from "./EditConfig";
import AddFetchedArticle from "./AddFetchedArticle";
import NewsroomThemeEditor from "./NewsroomThemeEditor";

const EditPage: FC<{ pageMode?: "editor" | "theme" }> = ({ pageMode = "editor" }) => {
  const {
    config,
    tabs,
    setConfig,
    setTabs,
    setSelectedProject,
    setGenerationId,
    generationId,
  } = useGlobalState();
  const router = useRouter();
  const params = useParams();
  const generationParam = params.generation;
  const routeGenerationId = Array.isArray(generationParam)
    ? generationParam[0]
    : generationParam;
  const isThemePage = pageMode === "theme";
  const { message, notification, modal } = App.useApp();
  const state = useReactive({
    selectedTab: tabs[0]?.manuscript.meta.uniqueId,
    manuscript: tabs,
    loadingGeneration: true,
    loadError: null as string | null,
    openArticleModal: false,
    brandId: "default",
    cleaningAssets: false,
  });

  useEffect(() => {
    if (!routeGenerationId) {
      state.loadingGeneration = false;
      router.replace("/");
      return;
    }
    const fetchGeneration = async () => {
      state.loadingGeneration = true;
      state.loadError = null;
      try {
        const response = await fetch(
          `/api/generations?id=${encodeURIComponent(String(routeGenerationId))}`
        );
        if (response.status === 404) {
          notification.warning({
            title: "Project no longer exists",
            description: "The generation was removed or the project folder was deleted.",
          });
          router.replace("/");
          return;
        }
        if (!response.ok) {
          throw new Error("Failed to fetch generation");
        }
        const generation = await response.json();
        if (!generation.config || !generation.projectId) {
          throw new Error("Generation payload is missing config or projectId");
        }
        setConfig({
          projectId: generation.projectId,
          config: generation.config,
        });
        setTabs(generation.data);
        setSelectedProject(
          generation.project || {
            id: generation.projectId,
            name: generation.projectId,
          }
        );
        setGenerationId(generation.id);
        state.brandId = generation.brandId || "default";
        state.selectedTab = generation.data?.[0]?.manuscript?.meta?.uniqueId;
      } catch (error) {
        console.error(error);
        state.loadError =
          error instanceof Error ? error.message : "Failed to load generation";
      } finally {
        state.loadingGeneration = false;
      }
    };
    void fetchGeneration();
  }, [
    params,
    routeGenerationId,
    router,
    setConfig,
    setTabs,
    setSelectedProject,
    setGenerationId,
    notification,
    state,
  ]);

  useEffect(() => {
    if (!state.selectedTab && tabs.length > 0) {
      state.selectedTab = tabs[0]?.manuscript.meta.uniqueId;
    }
  }, [state, tabs]);

  const [form] = Form.useForm();

  const resolvePersistId = () => {
    const idFromParams = Array.isArray(params.generation)
      ? params.generation[0]
      : params.generation;
    return generationId || String(idFromParams || "");
  };

  const persistTabs = async (nextTabs: Tab[], retiredProjectIds?: string[]) => {
    const persistId = resolvePersistId();
    if (!persistId) {
      return;
    }

    const response = await fetch("/api/generations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: persistId,
        data: nextTabs,
        retiredProjectIds,
      }),
    });
    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `Failed to persist generation (${response.status}): ${details}`
      );
    }
  };

  const reorderTabs = (currentTabs: Tab[], from: number, to: number): Tab[] => {
    const nextTabs = [...currentTabs];
    const [movedTab] = nextTabs.splice(from, 1);
    if (!movedTab) {
      return currentTabs;
    }
    nextTabs.splice(to, 0, movedTab);
    return nextTabs;
  };

  const handleAddArticle = async (tab: Tab) => {
    const currentTabs = (form.getFieldValue("tabs") || []) as Tab[];
    const nextTabs = [...currentTabs, tab];
    await persistTabs(nextTabs);
    form.setFieldValue("tabs", nextTabs);
    setTabs(nextTabs);
    state.selectedTab = tab.manuscript.meta.uniqueId;
  };

  const handleReorderArticles = async (from: number, to: number) => {
    const currentTabs = (form.getFieldValue("tabs") || []) as Tab[];
    const nextTabs = reorderTabs(currentTabs, from, to);
    await persistTabs(nextTabs);
    form.setFieldValue("tabs", nextTabs);
    setTabs(nextTabs);
  };

  const handleRemoveArticle = async (tabIndex: number) => {
    const currentTabs = (form.getFieldValue("tabs") || []) as Tab[];
    if (currentTabs.length <= 1) {
      notification.warning({
        title: "At least one article must remain in the generation.",
      });
      return;
    }

    const removedTab = currentTabs[tabIndex];
    const nextTabs = currentTabs.filter((_, index) => index !== tabIndex);
    const nextSelectedTab =
      state.selectedTab === removedTab?.manuscript?.meta?.uniqueId
        ? nextTabs[Math.min(tabIndex, nextTabs.length - 1)]?.manuscript?.meta?.uniqueId
        : state.selectedTab;
    const removedProjectId =
      removedTab?.projectId &&
      removedTab.projectId !== resolvePersistId()
        ? removedTab.projectId
        : undefined;

    await persistTabs(
      nextTabs,
      removedProjectId ? [removedProjectId] : undefined
    );
    form.setFieldValue("tabs", nextTabs);
    setTabs(nextTabs);
    state.selectedTab = nextSelectedTab;
    notification.success({ title: "Article removed from generation." });
  };

  const handleCleanupAssets = async () => {
    const persistId = resolvePersistId();
    if (!persistId) {
      return;
    }

    state.cleaningAssets = true;
    try {
      const currentTabs = (form.getFieldValue("tabs") || []) as Tab[];
      const response = await fetch("/api/generations/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generationId: persistId,
          data: currentTabs,
        }),
      });

      const payload = (await response.json()) as {
        error?: unknown;
        deletedFiles?: number;
        deletedProjects?: string[];
        projectsScanned?: number;
      };

      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : JSON.stringify(payload.error)
        );
      }

      notification.success({
        title: "Cleanup complete",
        description: `${payload.deletedFiles || 0} file(s) removed across ${
          payload.projectsScanned || 0
        } project(s)${
          payload.deletedProjects?.length
            ? `. Deleted retired article project(s): ${payload.deletedProjects.join(", ")}`
            : ""
        }.`,
        duration: 8,
      });
    } catch (error) {
      notification.error({
        title: "Cleanup failed",
        description:
          error instanceof Error ? error.message : "Unknown cleanup error",
        duration: 0,
      });
    } finally {
      state.cleaningAssets = false;
    }
  };

  if (state.loadingGeneration || !config) {
    return (
      <Flex vertical align="center" justify="center" className="p-8">
        {state.loadError ? (
          <Alert
            type="error"
            title="Failed to load project"
            description={state.loadError}
            action={
              <Button type="primary" onClick={() => router.replace("/")}>
                Back to start
              </Button>
            }
          />
        ) : (
          <Flex vertical align="center" gap="small">
            <Spin />
            <Typography.Text>Loading project...</Typography.Text>
          </Flex>
        )}
      </Flex>
    );
  }

  return (
    <Form
      preserve
      initialValues={{ tabs, config }}
      layout="vertical"
      form={form}
      component={isThemePage ? "div" : "form"}
    >
      <Flex vertical className="p-4">
        <Flex className="justify-between items-center py-2">
          <Typography.Title
            level={5}
            className="cursor-pointer"
            onClick={() => {
              router.push(`/`);
            }}
          >
            Videofy
          </Typography.Title>
          <Flex gap="small">
            <Tooltip title="Remove unused local assets and old renders">
              <Button
                icon={<ClearOutlined />}
                loading={state.cleaningAssets}
                onClick={() => {
                  void modal.confirm({
                    title: "Clean local assets?",
                    content:
                      "This removes old render files, unreferenced local media, and article projects that are no longer part of this generation.",
                    okText: "Clean assets",
                    onOk: handleCleanupAssets,
                  });
                }}
              >
                Clean assets
              </Button>
            </Tooltip>
            <Tooltip title="Share video">
              <Button
                icon={<ShareAltOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  message.success("Video URL copied to clipboard.", 5);
                }}
              >
                Share
              </Button>
            </Tooltip>
            <Tooltip title="Edit theme">
              <Button
                type={isThemePage ? "primary" : "default"}
                icon={<SettingOutlined />}
                onClick={() => {
                  if (!routeGenerationId) {
                    return;
                  }
                  router.push(
                    isThemePage
                      ? `/${encodeURIComponent(String(routeGenerationId))}`
                      : `/${encodeURIComponent(String(routeGenerationId))}/theme`
                  );
                }}
              >
                {isThemePage ? "Back to editor" : "Edit theme"}
              </Button>
            </Tooltip>
          </Flex>
        </Flex>
        <Flex gap="middle">
          <div className="xl:flex-row flex-col w-full">
            <Form.Item noStyle className="xl:flex-1 w-full" shouldUpdate>
              {({ getFieldsValue }) => {
                const manuscripts = getFieldsValue(true).tabs;
                return (
                  <div className="xl:flex-1 w-full">
                    <PreviewOutput tabs={manuscripts} />
                  </div>
                );
              }}
            </Form.Item>
          </div>
          <div className="w-full xl:max-w-[800px] xl:grow">
            {!isThemePage ? (
              <Form.List name={["tabs"]}>
                {(tabItems) => {
                  return (
                    <>
                      <Typography.Text
                        type="secondary"
                        style={{ display: "block", marginBottom: 8 }}
                      >
                        Drag article tabs to reorder them.
                      </Typography.Text>
                      <SortableTabs
                        allowAdd
                        onAdd={() => {
                          state.openArticleModal = true;
                        }}
                        activeKey={state.selectedTab}
                        onChange={(value) => {
                          state.selectedTab = value;
                        }}
                        onReorder={(from, to) => {
                          void handleReorderArticles(from, to);
                        }}
                        items={tabItems.map((t, index) => {
                          const tab = form.getFieldValue(["tabs", t.name]);
                          return {
                            key: tab.manuscript.meta.uniqueId!,
                            label: (
                              <Flex align="center" gap="small">
                                <Typography.Paragraph
                                  ellipsis={{
                                    tooltip: tab.manuscript.meta.title,
                                  }}
                                  style={{
                                    maxWidth: 250,
                                    marginBottom: 0,
                                    userSelect: "none",
                                  }}
                                >
                                  {tab.manuscript.meta.title}
                                </Typography.Paragraph>
                                {tabItems.length > 1 ? (
                                  <Tooltip title="Remove article">
                                    <Button
                                      type="text"
                                      size="small"
                                      danger
                                      icon={<CloseOutlined />}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void handleRemoveArticle(index);
                                      }}
                                    />
                                  </Tooltip>
                                ) : null}
                              </Flex>
                            ),
                            children: (
                              <SegmentList
                                index={t.name}
                                manuscript={tab.manuscript}
                              />
                            ),
                            forceRender: true,
                          };
                        })}
                      />
                    </>
                  );
                }}
              </Form.List>
            ) : (
              <NewsroomThemeEditor />
            )}
          </div>
        </Flex>
      </Flex>
      {state.openArticleModal && !isThemePage ? (
        <AddFetchedArticle
          open={state.openArticleModal}
          setOpen={(open) => {
            state.openArticleModal = open;
          }}
          brandId={state.brandId}
          onChange={handleAddArticle}
        />
      ) : null}
    </Form>
  );
};

export default EditPage;
