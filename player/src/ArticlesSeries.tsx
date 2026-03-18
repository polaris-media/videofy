import { useEffect, useMemo, type FC, type ReactElement } from "react";
import {
  AbsoluteFill,
  Sequence,
  continueRender,
  delayRender,
  prefetch,
  Series,
} from "remotion";
import type { z } from "zod";
import { playerSchema, type processedManuscriptSchema } from "@videofy/types";

import { BackgroundMusic } from "./Sequence/Assets/BackgroundMusic";
import { Intro } from "./Sequence/Assets/Intro";
import { Logo } from "./Sequence/Assets/Logo";
import { Outro } from "./Sequence/Assets/Outro";
import { OutroCard } from "./Sequence/Assets/OutroCard";
import { ReporterVideo } from "./Sequence/Assets/ReporterVideo";
import { Wipe } from "./Sequence/Assets/Wipe";
import { ExternalDisplayArticle } from "./Sequence/ExternalDisplayArticle";
import "./global.css";
import { defaultPlayerConfig } from "./types/constants";
import { getSelectedReporterIntro, getSelectedReporterOutro } from "./utils/findSelectedReporterVideo";
import { getAssetUrl } from "./utils/getAssetUrl";
import { getFullDuration, getSegmentDuration, roundToNearestFrame } from "./utils/timestamps";
import { loadFont } from "@remotion/google-fonts/Inter";

type Manuscript = z.infer<typeof processedManuscriptSchema>;
type PlayerConfig = z.infer<typeof playerSchema>;
type ReporterVideoAsset = {
  portrait: string;
  landscape: string;
  duration: number;
  selected?: boolean;
};

const { fontFamily } = loadFont("normal", {
  weights: ["400", "700"],
});

export interface ArticleSeriesProps {
  manuscripts?: Manuscript[];
  width?: number;
  height?: number;
  voice?: boolean;
  backgroundMusic?: boolean;
  disabledLogo?: boolean;
  playerConfig?: PlayerConfig;
  storyIndicator?: {
    length: number;
    current: number;
  };
}

function resolveOptionalAsset(baseUrl: string, assetPath: string | undefined): string | undefined {
  if (!assetPath) {
    return assetPath;
  }
  return getAssetUrl(baseUrl, assetPath);
}

function resolveCustomCut(
  baseUrl: string,
  cut: PlayerConfig["intro"] | PlayerConfig["wipe"] | PlayerConfig["outro"]
) {
  if (!cut) {
    return cut;
  }

  return {
    ...cut,
    portrait: getAssetUrl(baseUrl, cut.portrait),
    landscape: getAssetUrl(baseUrl, cut.landscape),
  };
}

function resolveReporterVideoSet(
  baseUrl: string,
  reporterVideos: Record<string, ReporterVideoAsset> | undefined
): Record<string, ReporterVideoAsset> | undefined {
  if (!reporterVideos) {
    return reporterVideos;
  }

  return Object.fromEntries(
    Object.entries(reporterVideos).map(([reporterName, video]) => [
      reporterName,
      {
        ...video,
        duration: video.duration ?? 0,
        portrait: getAssetUrl(baseUrl, video.portrait),
        landscape: getAssetUrl(baseUrl, video.landscape),
      },
    ])
  );
}

function buildExpandedPlayerConfig(playerConfig: PlayerConfig): PlayerConfig {
  const assetBaseUrl = playerConfig.assetBaseUrl;
  if (!assetBaseUrl) {
    throw new Error("Asset base URL is missing in player config");
  }

  const resolvedFonts = playerConfig.fonts
    ? Object.fromEntries(
        Object.entries(playerConfig.fonts).map(([fontName, fontFile]) => [
          fontName,
          getAssetUrl(assetBaseUrl, fontFile),
        ])
      )
    : undefined;

  return {
    ...playerConfig,
    fonts: resolvedFonts,
    logo: playerConfig.logo ? getAssetUrl(assetBaseUrl, playerConfig.logo) : undefined,
    outroCard: playerConfig.outroCard
      ? {
          ...playerConfig.outroCard,
          backgroundImage: playerConfig.outroCard.backgroundImage
            ? getAssetUrl(assetBaseUrl, playerConfig.outroCard.backgroundImage)
            : undefined,
          logo: playerConfig.outroCard.logo
            ? getAssetUrl(assetBaseUrl, playerConfig.outroCard.logo)
            : playerConfig.logo
              ? getAssetUrl(assetBaseUrl, playerConfig.logo)
              : undefined,
        }
      : undefined,
    intro: resolveCustomCut(assetBaseUrl, playerConfig.intro),
    wipe: resolveCustomCut(assetBaseUrl, playerConfig.wipe),
    outro: resolveCustomCut(assetBaseUrl, playerConfig.outro),
    backgroundMusic: resolveOptionalAsset(assetBaseUrl, playerConfig.backgroundMusic),
    reporterVideos: playerConfig.reporterVideos
      ? {
          intro: resolveReporterVideoSet(assetBaseUrl, playerConfig.reporterVideos.intro),
          outro: resolveReporterVideoSet(assetBaseUrl, playerConfig.reporterVideos.outro),
        }
      : undefined,
  };
}

function collectPrefetchUrls(manuscripts: Manuscript[]): string[] {
  const urls = new Set<string>();

  for (const manuscript of manuscripts) {
    for (const segment of manuscript.segments) {
      for (const asset of segment.images || []) {
        if (asset.type === "map") {
          continue;
        }
        if (asset.url) {
          urls.add(asset.url);
        }
      }
    }

    if (manuscript.meta.audio?.src) {
      urls.add(manuscript.meta.audio.src);
    }
  }

  return [...urls];
}

function buildSeriesSequences(
  manuscripts: Manuscript[],
  expandedPlayerConfig: PlayerConfig,
  voice: boolean,
  storyIndicator?: ArticleSeriesProps["storyIndicator"]
): ReactElement[] {
  const sequenceItems: ReactElement[] = [];
  const reporterIntro = getSelectedReporterIntro(expandedPlayerConfig);
  const reporterOutro = getSelectedReporterOutro(expandedPlayerConfig);

  if (expandedPlayerConfig.intro) {
    const introDuration = roundToNearestFrame(expandedPlayerConfig.intro.duration);
    sequenceItems.push(
      <Series.Sequence
        key="intro-sequence"
        style={{ zIndex: 1 }}
        durationInFrames={introDuration}
      >
        <Intro asset={expandedPlayerConfig.intro} introDuration={introDuration} />
      </Series.Sequence>
    );
  }

  if (reporterIntro) {
    const reporterIntroDuration = roundToNearestFrame(reporterIntro.duration || 0);
    sequenceItems.push(
      <Series.Sequence
        key="reporter-intro-sequence"
        offset={roundToNearestFrame(expandedPlayerConfig.intro?.offset ?? 0)}
        durationInFrames={reporterIntroDuration}
      >
        <ReporterVideo asset={reporterIntro} duration={reporterIntroDuration} />
      </Series.Sequence>
    );
  }

  for (const [manuscriptIndex, manuscript] of manuscripts.entries()) {
    const manuscriptKey = manuscript.meta.uniqueId || `${manuscript.meta.id}-${manuscriptIndex}`;
    const articleKey = `article-${manuscriptKey}-${manuscriptIndex}`;
    const indicator =
      storyIndicator && manuscripts.length === 1
        ? storyIndicator
        : { length: manuscripts.length, current: manuscriptIndex };

    sequenceItems.push(
      <Series.Sequence
        key={articleKey}
        offset={
          manuscriptIndex === 0
            ? reporterIntro
              ? 0
              : roundToNearestFrame(expandedPlayerConfig.intro?.offset ?? 0)
            : roundToNearestFrame(expandedPlayerConfig.wipe?.offset ?? 0)
        }
        durationInFrames={getSegmentDuration(manuscript)}
      >
        <ExternalDisplayArticle
          indicator={indicator}
          voice={voice}
          manuscript={manuscript}
          config={expandedPlayerConfig}
        />
      </Series.Sequence>
    );

    if (expandedPlayerConfig.wipe && manuscriptIndex !== manuscripts.length - 1) {
      const wipeDuration = roundToNearestFrame(expandedPlayerConfig.wipe.duration);
      sequenceItems.push(
        <Series.Sequence
          key={`wipe-${manuscriptKey}-${manuscriptIndex}`}
          offset={roundToNearestFrame(expandedPlayerConfig.wipe.offset)}
          durationInFrames={wipeDuration}
          style={{ zIndex: 1 }}
        >
          <Wipe duration={wipeDuration} asset={expandedPlayerConfig.wipe} />
        </Series.Sequence>
      );
    }
  }

  if (reporterOutro) {
    const reporterOutroDuration = roundToNearestFrame(reporterOutro.duration || 0);
    sequenceItems.push(
      <Series.Sequence key="reporter-outro-sequence" durationInFrames={reporterOutroDuration}>
        <ReporterVideo asset={reporterOutro} duration={reporterOutroDuration} />
      </Series.Sequence>
    );
  }

  if (expandedPlayerConfig.outro) {
    const outroDuration = roundToNearestFrame(expandedPlayerConfig.outro.duration);
    sequenceItems.push(
      <Series.Sequence
        key="outro-sequence"
        durationInFrames={outroDuration}
        offset={roundToNearestFrame(expandedPlayerConfig.outro.offset)}
      >
        <Outro asset={expandedPlayerConfig.outro} outroDuration={outroDuration} />
      </Series.Sequence>
    );
  }

  if (expandedPlayerConfig.outroCard) {
    const outroCardDuration = roundToNearestFrame(expandedPlayerConfig.outroCard.duration);
    sequenceItems.push(
      <Series.Sequence key="outro-card-sequence" durationInFrames={outroCardDuration}>
        <OutroCard durationInFrames={outroCardDuration} card={expandedPlayerConfig.outroCard} />
      </Series.Sequence>
    );
  }

  return sequenceItems;
}

export const ArticlesSeries: FC<ArticleSeriesProps> = ({
  manuscripts,
  voice = true,
  backgroundMusic = true,
  disabledLogo = false,
  playerConfig = defaultPlayerConfig,
  storyIndicator,
}) => {
  const expandedPlayerConfig = useMemo(
    () => buildExpandedPlayerConfig(playerConfig),
    [playerConfig]
  );

  useEffect(() => {
    if (!manuscripts) {
      return;
    }

    const prefetchHandles = collectPrefetchUrls(manuscripts).map((assetUrl) => {
      const handle = prefetch(assetUrl);
      handle.waitUntilDone().catch((error) => {
        console.warn(`Prefetch failed for asset: ${assetUrl}`, error);
      });
      return handle;
    });

    return () => {
      for (const handle of prefetchHandles) {
        try {
          handle.free();
        } catch (error) {
          console.warn("Failed to free prefetched asset", error);
        }
      }
    };
  }, [manuscripts]);

  useEffect(() => {
    const loadConfiguredFonts = async () => {
      for (const [fontName, fontFile] of Object.entries(expandedPlayerConfig.fonts || {})) {
        const renderHandle = delayRender();
        const fontFace = new FontFace(fontName, `url('${fontFile}')`);

        try {
          const loadedFont = await fontFace.load();
          (document.fonts as unknown as { add: (font: FontFace) => void }).add(loadedFont);
        } catch (error) {
          console.warn(`Failed to load font '${fontName}'`, error);
        } finally {
          continueRender(renderHandle);
        }
      }
    };

    void loadConfiguredFonts();
  }, [expandedPlayerConfig.fonts]);

  if (!manuscripts) {
    return null;
  }

  const sequences = buildSeriesSequences(
    manuscripts,
    expandedPlayerConfig,
    voice,
    storyIndicator
  );
  const outroCardDuration = roundToNearestFrame(expandedPlayerConfig.outroCard?.duration ?? 0);
  const logoDuration = getFullDuration({
    manuscripts,
    playerConfig: expandedPlayerConfig,
  });

  return (
    <AbsoluteFill className="article-series" style={{ fontFamily }}>
      <Series>{sequences}</Series>
      {!disabledLogo && (
        <Sequence durationInFrames={Math.max(logoDuration - outroCardDuration, 0)}>
          <Logo
            logo={expandedPlayerConfig.logo}
            logoStyle={expandedPlayerConfig.logoStyle}
            logoText={expandedPlayerConfig.logoText}
            logoTextStyle={expandedPlayerConfig.logoTextStyle}
          />
        </Sequence>
      )}
      {backgroundMusic && expandedPlayerConfig.backgroundMusic && (
        <BackgroundMusic
          backgroundMusic={expandedPlayerConfig.backgroundMusic}
          volume={expandedPlayerConfig.backgroundMusicVolume}
          manuscripts={manuscripts}
        />
      )}
    </AbsoluteFill>
  );
};
