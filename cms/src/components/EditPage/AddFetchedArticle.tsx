"use client";

import { useEffect, useMemo, type FC } from "react";
import { useReactive } from "ahooks";
import { App, Button, Form, Input, Modal, Select, Spin, Typography } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { runFetcherPlugin, saveProjectConfig, setProjectBrand, useFetchers } from "@/api";
import { generateManuscript } from "@/utils/generateManuscript";
import { Tab, useGlobalState } from "@/state/globalState";
import PolarisArticleAssist from "@/components/FetcherFields/PolarisArticleAssist";
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

type FormType = {
  fetcherId: string;
  model: GenerationModel;
  inputs: Record<string, string | string[]>;
};

type AddFetchedArticleProps = {
  open: boolean;
  setOpen: (open: boolean) => void;
  brandId: string;
  onChange: (tabs: Tab[]) => Promise<void>;
};

const DEFAULT_FETCHER_ID = "polaris-capi";

const AddFetchedArticle: FC<AddFetchedArticleProps> = ({
  open,
  setOpen,
  brandId,
  onChange,
}) => {
  const [form] = Form.useForm<FormType>();
  const { data: fetchers, isLoading: loadingFetchers } = useFetchers();
  const { config } = useGlobalState();
  const { notification } = App.useApp();

  const state = useReactive({
    loading: false,
    loadingMessage: "Fetching article...",
  });

  const selectedFetcherId = Form.useWatch("fetcherId", form);
  const selectedArticleRef = Form.useWatch(["inputs", "article_ref"], form);
  const selectedArticleRefs = Form.useWatch(["inputs", "article_refs"], form);
  const selectedFetcher = useMemo(
    () => fetchers?.find((fetcher) => fetcher.id === selectedFetcherId),
    [fetchers, selectedFetcherId]
  );
  const fields = useMemo(
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
      model: resolveGenerationModel(config?.config?.openai?.manuscriptModel, "gpt-4o"),
      inputs: {},
    });
  }, [config?.config?.openai?.manuscriptModel, fetchers, form]);

  useEffect(() => {
    if (!selectedFetcherId) {
      return;
    }
    form.setFieldValue("inputs", {});
  }, [selectedFetcherId, form]);

  const handleClose = () => {
    if (state.loading) {
      return;
    }
    setOpen(false);
    form.resetFields();
  };

  const handleAddArticle = async (values: FormType) => {
    if (!config?.config) {
      notification.error({ title: "Config is not loaded yet." });
      return;
    }
    state.loading = true;
    state.loadingMessage = "Fetching article...";
    try {
      const rawInputs = values.inputs || {};
      const watchedArticleRefs = parseArticleRefsInput(selectedArticleRefs);
      const articleRefs =
        values.fetcherId === "polaris-capi"
          ? (() => {
              const fromSubmit = parseArticleRefsInput(rawInputs.article_refs);
              return fromSubmit.length > 0 ? fromSubmit : watchedArticleRefs;
            })()
          : [];
      const manualArticleRef =
        parseArticleRefInput(rawInputs.article_ref) || parseArticleRefInput(selectedArticleRef);

      if (values.fetcherId === "polaris-capi" && articleRefs.length === 0 && !manualArticleRef) {
        throw new Error("Select one or more articles, or paste a Polaris article URL.");
      }

      const fetchTargets =
        articleRefs.length > 0
          ? articleRefs
          : values.fetcherId === "polaris-capi" && manualArticleRef
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

      const addedTabs: Tab[] = [];
      const failedTargets: string[] = [];
      const failureMessages: string[] = [];

      for (const [targetIndex, articleRef] of fetchTargets.entries()) {
        const fetchLabel =
          articleRef || selectedFetcher?.title || `article ${targetIndex + 1}`;
        state.loadingMessage = `Fetching ${targetIndex + 1}/${fetchTargets.length}...`;

        try {
          const fetchResult = await runFetcherPlugin({
            fetcherId: values.fetcherId,
            inputs: articleRef
              ? {
                  ...baseInputs,
                  article_ref: articleRef,
                }
              : baseInputs,
          });

          state.loadingMessage = `Applying brand ${targetIndex + 1}/${fetchTargets.length}...`;
          await setProjectBrand(fetchResult.projectId, brandId || "default");

          const customizedConfig = {
            ...config.config,
            openai: {
              ...(config.config.openai || {}),
              manuscriptModel: values.model,
              mediaModel: values.model,
            },
          };

          await saveProjectConfig(fetchResult.projectId, customizedConfig);

          state.loadingMessage = `Generating ${targetIndex + 1}/${fetchTargets.length}...`;
          const manuscript = await generateManuscript(fetchResult.projectId, customizedConfig);
          const cleanedManuscript = {
            ...manuscript,
            meta: {
              ...manuscript.meta,
              articleUrl: fetchResult.projectId,
              uniqueId: randomId(),
            },
          };

          addedTabs.push({
            articleUrl: fetchResult.projectId,
            projectId: fetchResult.projectId,
            manuscript: cleanedManuscript,
          });
        } catch (error) {
          console.error(`[add-article] Failed to fetch target '${fetchLabel}':`, error);
          failedTargets.push(fetchLabel);
          failureMessages.push(
            error instanceof Error ? `${fetchLabel}: ${error.message}` : fetchLabel
          );
        }
      }

      if (addedTabs.length === 0) {
        throw new Error(
          failureMessages[0]
            ? `Failed to add the selected article(s). ${failureMessages[0]}`
            : "Failed to add the selected article(s)."
        );
      }

      await onChange(addedTabs);

      setOpen(false);
      form.resetFields();

      if (failedTargets.length > 0) {
        notification.warning({
          title: `Added ${addedTabs.length} article(s), ${failedTargets.length} failed`,
          description: failedTargets.join(", "),
          duration: 0,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add article";
      notification.error({ title: message, duration: 0 });
    } finally {
      state.loading = false;
      state.loadingMessage = "Fetching article...";
    }
  };

  return (
    <Modal
      title="Legg til artikkel"
      open={open}
      onCancel={handleClose}
      width={700}
      footer={[
        <Button key="cancel" onClick={handleClose} disabled={state.loading}>
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          icon={state.loading ? <LoadingOutlined spin /> : undefined}
          onClick={() => form.submit()}
          disabled={loadingFetchers}
        >
          {state.loading ? state.loadingMessage : "Add Article"}
        </Button>,
      ]}
    >
      {loadingFetchers ? (
        <Spin description="Loading fetchers..." />
      ) : (
        <Form form={form} layout="vertical" onFinish={handleAddArticle}>
          <Form.Item name="fetcherId" label="Fetcher" rules={[{ required: true }]}>
            <Select
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
              options={fetchers?.map((fetcher) => ({
                value: fetcher.id,
                label: fetcher.title,
              }))}
            />
          </Form.Item>
          {selectedFetcher?.description ? (
            <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
              {selectedFetcher.description}
            </Typography.Paragraph>
          ) : null}
          <Form.Item name="model" label="OpenAI model" rules={[{ required: true }]}>
            <Select options={GENERATION_MODEL_OPTIONS} />
          </Form.Item>
          {fields.map((field) => (
            <Form.Item
              key={field.name}
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
          ))}
          {selectedFetcher?.id === "polaris-capi" ? (
            <PolarisArticleAssist form={form} />
          ) : null}
        </Form>
      )}
    </Modal>
  );
};

export default AddFetchedArticle;
