import { manuscriptSchema } from "@videofy/types";
import { ProcessedManuscript } from "@videofy/types";
import { devtools } from "zustand/middleware";
import { z } from "zod";
import { create } from "zustand";
import { ApiConfig, ProjectOption } from "@/api";

export type Tab = {
  articleUrl: string;
  manuscript: Manuscript;
  projectId?: string;
  backendGenerationId?: string;
};

export type Manuscript = z.infer<typeof manuscriptSchema>;
interface StoreState {
  config: ApiConfig;
  setConfig: (config: ApiConfig) => void;
  tabs: Array<Tab>;
  setTabs(tabs: Array<Tab>): void;
  currentTab: Tab;
  currentTabIndex: number;
  setCurrentTabIndex: (index: number) => void;
  customPrompt: string;
  processedManuscripts: Array<ProcessedManuscript>;
  setCustomPrompt: (customPrompt: string) => void;
  setProcessedManuscripts: (
    processedManuscripts: Array<ProcessedManuscript>
  ) => void;
  generationId: string;
  setGenerationId: (id: string) => void;
  selectedProject?: ProjectOption;
  setSelectedProject: (project?: ProjectOption) => void;
}

export const useGlobalState = create<StoreState>()(
  devtools((set, get) => ({
    config: null! as ApiConfig,
    setConfig: (config) => set({ config }),
    tabs: [],
    setTabs: (tabs) => set({ tabs }),
    currentTab: null!,
    currentTabIndex: null!,
    setCurrentTabIndex: (currentTabIndex) =>
      set({ currentTabIndex, currentTab: get().tabs[currentTabIndex] }),
    customPrompt: "",
    setCustomPrompt: (customPrompt) => set({ customPrompt }),
    processedManuscripts: [],
    setProcessedManuscripts: (processedManuscripts) =>
      set({ processedManuscripts }),
    generationId: "",
    setGenerationId: (generationId) => set({ generationId }),
    selectedProject: undefined,
    setSelectedProject: (selectedProject) => set({ selectedProject }),
  }))
);
