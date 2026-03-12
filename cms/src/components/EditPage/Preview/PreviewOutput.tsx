"use client";
import type { processedManuscriptSchema } from "@videofy/types";
import { processManuscript } from "@/utils/processManuscript";
import type { PlayerRef } from "@remotion/player";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useReactive } from "ahooks";
import type { z } from "zod";
import { Player } from "@videofy/player";
import ErrorCard from "./ErrorCard";
import LoadingCard from "./LoadingCard";
import { Tab, useGlobalState } from "@/state/globalState";
import { DesktopOutlined, MobileOutlined } from "@ant-design/icons";
import { Button, Segmented, Tooltip } from "antd";
import DownloadModal from "./DownloadModal";

type Result = z.infer<typeof processedManuscriptSchema>;

const PreviewOutput = ({ tabs }: { tabs: Tab[] }) => {
  const state = useReactive({
    loading: true,
    updating: false,
    error: null as string | null,
    previewType: "Vertical" as "Vertical" | "Horizontal",
    downloadOpen: false,
  });
  const abortController = useRef(new AbortController());
  const initialized = useRef(false);

  const {
    config: { config },
    processedManuscripts,
    setProcessedManuscripts,
    generationId,
  } = useGlobalState();

  const playerRef = useRef<PlayerRef>(null);

  const handleError = useCallback(
    (error: unknown) => {
      console.error(error);
      setProcessedManuscripts([]);
      if (typeof error === "string") {
        state.error = error || "Unknown reason.";
      } else if (error instanceof Error) {
        state.error = error?.message || "Unknown reason.";
      } else {
        state.error = "Unknown reason.";
      }
    },
    [setProcessedManuscripts, state]
  );

  const fetchData = useCallback(
    async (updating = false) => {
      if (!(tabs && config)) return;

      try {
        initialized.current = true;

        if (updating) {
          state.updating = true;
        } else {
          state.loading = true;
        }
        const results = await Promise.all(
          tabs.map((tab) => {
            return processManuscript({
              abortController: abortController.current,
              manuscript: tab.manuscript,
              config: config,
              uniqueId: tab.manuscript.meta.uniqueId!,
              projectId: tab.projectId || generationId || tab.articleUrl,
              backendGenerationId: tab.backendGenerationId,
            });
          })
        );

        state.error = null;
        setProcessedManuscripts(
          results.filter((result) => result !== null) as Array<Result>
        );
        if (playerRef.current) playerRef.current.seekTo(0);
      } catch (error) {
        handleError(error);
      } finally {
        if (updating) {
          state.updating = false;
        } else {
          state.loading = false;
        }
        initialized.current = false;
      }
    },
    [config, handleError, setProcessedManuscripts, state, tabs]
  );

  const updatePreview = async () => {
    if (playerRef.current) {
      playerRef.current.pause();
    }
    await fetchData(true);
    await fetch("/api/generations", {
      method: "PUT",
      body: JSON.stringify({
        id: generationId || tabs[0]?.projectId || tabs[0]?.articleUrl,
        data: tabs,
      }),
    });
  };

  useEffect(() => {
    if (initialized.current) return;
    if (playerRef.current) {
      playerRef.current.pause();
    }

    fetchData();
  }, []);

  const playerConfig = useMemo(
    () => ({
      ...config.player!,
      assetBaseUrl:
        typeof window !== "undefined"
          ? window.location.origin
          : process.env.NEXT_PUBLIC_CMS_BASE_URL || "http://127.0.0.1:3000",
    }),
    [config.player]
  );
  const hasNarrationAudio = useMemo(
    () =>
      processedManuscripts.length > 0 &&
      processedManuscripts.every((manuscript) => Boolean(manuscript.meta.audio?.src)),
    [processedManuscripts]
  );

  return (
    <div className="top-0 sticky flex flex-col w-full">
      {state.error && !state.updating && !state.loading ? (
        <ErrorCard errorMessage={state.error} />
      ) : !processedManuscripts.length && (state.updating || state.loading) ? (
        <LoadingCard />
      ) : (
        <>
          <div className="relative">
            <Player
              ref={playerRef}
              height={state.previewType === "Vertical" ? 1920 : 1080}
              width={state.previewType === "Vertical" ? 1080 : 1920}
              manuscripts={processedManuscripts}
              voice={hasNarrationAudio}
              playerConfig={playerConfig}
              style={{
                maxHeight:
                  state.previewType === "Vertical" ? "80dvh" : undefined,
                width: "100%",
                aspectRatio: state.previewType === "Vertical" ? "9/16" : "16/9",
              }}
            />
            {(state.loading || state.updating) && (
              <div className="z-10 absolute inset-0 flex justify-center items-center bg-gray-500 bg-opacity-75">
                <span className="font-semibold text-white text-lg">
                  Preview is generating...
                </span>
              </div>
            )}
          </div>
        </>
      )}
      <div className="flex justify-center items-end gap-2 mt-4 w-full">
        <Tooltip title="Layout: vertical or horizontal">
          <Segmented
            options={[
              { value: "Vertical", icon: <MobileOutlined /> },
              {
                value: "Horizontal",
                icon: <DesktopOutlined />,
              },
            ]}
            value={state.previewType}
            onChange={(value) => {
              state.previewType = value as "Horizontal" | "Vertical";
            }}
          />
        </Tooltip>
        <Button
          onClick={updatePreview}
          disabled={state.loading || state.updating}
          type="primary"
        >
          Update
        </Button>
        <Button
          disabled={state.loading || state.updating}
          hidden={!!state.error || !processedManuscripts.length}
          type="primary"
          onClick={() => {
            updatePreview();
            state.downloadOpen = true;
          }}
        >
          Download
        </Button>
        <DownloadModal
          open={state.downloadOpen}
          setOpen={(open) => (state.downloadOpen = open)}
        />
      </div>
    </div>
  );
};

export default memo(PreviewOutput);
