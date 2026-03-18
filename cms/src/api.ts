import axios from "axios";
import { useCallback, useEffect, useState } from "react";
import { Config, VideoType } from "@videofy/types";

export type ProjectOption = {
  id: string;
  name: string;
};

export type ApiConfig = {
  projectId: string;
  config: Config;
};

export const getProjects = async (): Promise<ProjectOption[]> => {
  const response = await axios.get<{ projects: string[] }>("/api/projects");
  return response.data.projects.map((projectId) => ({
    id: projectId,
    name: projectId,
  }));
};

export const getConfigs = async (): Promise<ApiConfig[]> => {
  const response = await axios.get<ApiConfig[]>("/api/configs");
  return response.data;
};

export type FetcherField = {
  name: string;
  label: string;
  required: boolean;
  placeholder?: string;
};

export type FetcherOption = {
  id: string;
  title: string;
  description: string;
  fields: FetcherField[];
};

export type RunFetcherPayload = {
  fetcherId: string;
  inputs: Record<string, string>;
};

export type RunFetcherResult = {
  projectId: string;
  stdout: string;
  stderr: string;
  command: string[];
};

export type BrandOption = {
  id: string;
  brandName: string;
  scriptPrompt: string;
  manuscriptModel?: string;
  promptOptions: Array<{
    id: string;
    label: string;
    prompt: string;
    description?: string;
  }>;
};

export type GenerationSummary = {
  id: string;
  projectId: string;
  title: string;
  articleCount: number;
  brandId?: string;
  newsroom?: string;
  createdDate: string;
  updatedAt: string;
};

export type AIUsageTotals = {
  openai: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    reasoningTokens: number;
  };
  elevenlabs: {
    calls: number;
    characters: number;
  };
  preview: {
    withoutAudio: number;
    withElevenLabs: number;
  };
};

export type AIUsageProjectSummary = {
  projectId?: string;
  updatedAt?: string;
  totals: AIUsageTotals;
  brandId?: string;
  newsroom?: string;
  title?: string;
  articleCount?: number;
};

export type AIUsageResponse =
  | AIUsageProjectSummary
  | {
      totals: AIUsageTotals;
      groups: {
        newsrooms: Array<{
          key: string;
          label: string;
          projectCount: number;
          totals: AIUsageTotals;
        }>;
        brands: Array<{
          key: string;
          label: string;
          projectCount: number;
          totals: AIUsageTotals;
        }>;
      };
      projects: AIUsageProjectSummary[];
    };

export type PolarisArticleItem = {
  id: string;
  locale?: string;
  newsroom: string;
  type: string;
  title?: string;
};

export type PolarisNewsroomItem = {
  name: string;
  region?: string;
  domain: string;
  newsroom: string;
  lang?: string;
  municipality?: string;
  county?: string;
};

export type SvpVideoItem = {
  id: string;
  title: string;
  description?: string | null;
  duration?: number | null;
  published?: number | null;
  provider?: string | null;
  categoryTitle?: string | null;
  imageUrl?: string | null;
  playableUrl?: string | null;
  aspectRatio?: string | null;
  streamProperties?: string[];
  streamUrls: {
    hls?: string | null;
    hds?: string | null;
    mp4?: string | null;
    pseudostreaming?: string[] | null;
  };
};

export type NewsroomBrandingEntry = {
  domain?: string;
  image?: string;
  text?: string;
  logoMode?: "auto" | "image" | "text";
  logoStyle?: string;
  logoTextStyle?: string;
  disableIntro?: boolean;
  disableWipe?: boolean;
  disableOutro?: boolean;
  player?: Record<string, unknown>;
};

export type NewsroomBrandingResponse = {
  projectId: string;
  newsroom?: string;
  entry: NewsroomBrandingEntry;
  defaultEntry: NewsroomBrandingEntry;
};

export const getFetchers = async (): Promise<FetcherOption[]> => {
  const response = await axios.get<{ fetchers: FetcherOption[] }>("/api/fetchers");
  return response.data.fetchers;
};

export const runFetcherPlugin = async (
  payload: RunFetcherPayload
): Promise<RunFetcherResult> => {
  const response = await axios.post<RunFetcherResult>("/api/fetchers", payload);
  return response.data;
};

export const getBrands = async (): Promise<BrandOption[]> => {
  const response = await axios.get<{ brands: BrandOption[] }>("/api/brands");
  return response.data.brands;
};

export const getGenerations = async (): Promise<GenerationSummary[]> => {
  const response = await axios.get<{ generations: GenerationSummary[] }>("/api/generations");
  return response.data.generations;
};

export const getAIUsage = async (
  projectId?: string,
  newsroom?: string
): Promise<AIUsageResponse> => {
  const params = new URLSearchParams();
  if (projectId) {
    params.set("projectId", projectId);
  }
  if (newsroom) {
    params.set("newsroom", newsroom);
  }
  const response = await axios.get<AIUsageResponse>(
    params.size > 0 ? `/api/ai-usage?${params.toString()}` : "/api/ai-usage"
  );
  return response.data;
};

export const setProjectBrand = async (
  projectId: string,
  brandId: string
): Promise<void> => {
  await axios.patch(`/api/projects/${encodeURIComponent(projectId)}/manifest`, {
    brandId,
  });
};

export const getPolarisArticles = async (
  newsroom: string
): Promise<PolarisArticleItem[]> => {
  const response = await axios.get<{ items: PolarisArticleItem[] }>(
    `/api/polaris/articles?newsroom=${encodeURIComponent(newsroom)}`
  );
  return response.data.items;
};

export const getPolarisNewsrooms = async (): Promise<PolarisNewsroomItem[]> => {
  const response = await axios.get<{ items: PolarisNewsroomItem[] }>(
    "/api/polaris/newsrooms"
  );
  return response.data.items;
};

export const getSvpVideos = async (
  newsroom: string
): Promise<{ items: SvpVideoItem[]; provider: string; newsroom: string }> => {
  const response = await axios.get<{
    items: SvpVideoItem[];
    provider: string;
    newsroom: string;
  }>(`/api/svp/assets?newsroom=${encodeURIComponent(newsroom)}`);
  return response.data;
};

export const getSvpVideoByAssetId = async (
  newsroom: string,
  assetId: string
): Promise<{ item: SvpVideoItem; provider: string; newsroom: string }> => {
  const response = await axios.get<{
    item: SvpVideoItem;
    provider: string;
    newsroom: string;
  }>(
    `/api/svp/assets?newsroom=${encodeURIComponent(newsroom)}&assetId=${encodeURIComponent(assetId)}`
  );
  return response.data;
};

export const importSvpVideo = async (
  projectId: string,
  item: SvpVideoItem
): Promise<VideoType> => {
  const response = await axios.post<{ video: VideoType }>("/api/svp/import", {
    projectId,
    item,
  });
  return response.data.video;
};

export const getProjectConfig = async (projectId: string): Promise<ApiConfig> => {
  const response = await axios.get<ApiConfig>(
    `/api/configs?projectId=${encodeURIComponent(projectId)}`
  );
  return response.data;
};

export const saveProjectConfig = async (
  projectId: string,
  config: Config
): Promise<void> => {
  await axios.put("/api/configs", {
    projectId,
    config,
  });
};

export const getNewsroomBranding = async (
  projectId: string
): Promise<NewsroomBrandingResponse> => {
  const response = await axios.get<NewsroomBrandingResponse>(
    `/api/newsroom-branding?projectId=${encodeURIComponent(projectId)}`
  );
  return response.data;
};

export const saveNewsroomBranding = async (
  newsroom: string,
  entry: NewsroomBrandingEntry
): Promise<void> => {
  await axios.put("/api/newsroom-branding", {
    newsroom,
    entry,
  });
};

type FetchState<T> = {
  data: T | undefined;
  error: Error | undefined;
  isLoading: boolean;
  refresh: () => Promise<void>;
};

function useResource<T>(
  fetchFn: (() => Promise<T>) | null,
  deps: Array<unknown>
): FetchState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(fetchFn));

  const refresh = useCallback(async () => {
    if (!fetchFn) {
      setData(undefined);
      setError(undefined);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      const result = await fetchFn();
      setData(result);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    void refresh();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, isLoading, refresh };
}

export const useProjects = () => useResource<ProjectOption[]>(getProjects, []);

export interface ProjectAssetList {
  files: string[];
}

const getProjectAssets = async (url: string): Promise<ProjectAssetList> => {
  const response = await axios.get<ProjectAssetList>(url);
  return response.data;
};

export const useProjectAssets = (projectId: string | null | undefined) => {
  const fetchFn = projectId
    ? () => getProjectAssets(`/api/assets/${projectId}`)
    : null;
  return useResource<ProjectAssetList>(fetchFn, [projectId]);
};

export const useConfigs = () =>
  useResource<ApiConfig[]>(getConfigs, []);

export const useFetchers = () =>
  useResource<FetcherOption[]>(getFetchers, []);

export const useBrands = () =>
  useResource<BrandOption[]>(getBrands, []);

export const useGenerations = () =>
  useResource<GenerationSummary[]>(getGenerations, []);

export const useAIUsage = (projectId?: string, newsroom?: string) =>
  useResource<AIUsageResponse>(() => getAIUsage(projectId, newsroom), [projectId, newsroom]);
