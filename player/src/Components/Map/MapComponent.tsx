import { useMemo, type FC } from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { z } from "zod";
import type { mapSchema } from "@videofy/types";
import { playerSchema } from "@videofy/types";
import { cssStringToReactStyle } from "../../utils/cssStringToReactStyle";

type PlayerConfig = z.infer<typeof playerSchema>;

const TILE_SIZE = 256;
const MIN_TILE_ZOOM = 2;
const MAX_TILE_ZOOM = 17;

interface Props {
  asset: z.infer<typeof mapSchema>;
  config: PlayerConfig;
}

type Tile = {
  key: string;
  src: string;
  left: number;
  top: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function longitudeToWorldX(longitude: number, zoom: number): number {
  const scale = 2 ** zoom;
  return ((longitude + 180) / 360) * scale * TILE_SIZE;
}

function latitudeToWorldY(latitude: number, zoom: number): number {
  const latRad = (latitude * Math.PI) / 180;
  const mercator =
    (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2;
  return mercator * (2 ** zoom) * TILE_SIZE;
}

function normalizeTileX(x: number, zoom: number): number {
  const max = 2 ** zoom;
  return ((x % max) + max) % max;
}

function resolvePresetZoom(detailLevel: Props["asset"]["detailLevel"]) {
  switch (detailLevel) {
    case "overview":
      return { start: 5.5, end: 7.5 };
    case "close":
      return { start: 12.5, end: 15 };
    case "standard":
    default:
      return { start: 8, end: 13 };
  }
}

function buildTiles(
  latitude: number,
  longitude: number,
  tileZoom: number,
  width: number,
  height: number,
  minScale: number
): Tile[] {
  const centerX = longitudeToWorldX(longitude, tileZoom);
  const centerY = latitudeToWorldY(latitude, tileZoom);
  const overscanWorldWidth = width / Math.max(minScale, 0.5) + TILE_SIZE * 2;
  const overscanWorldHeight = height / Math.max(minScale, 0.5) + TILE_SIZE * 2;
  const minTileX = Math.floor((centerX - overscanWorldWidth / 2) / TILE_SIZE);
  const maxTileX = Math.floor((centerX + overscanWorldWidth / 2) / TILE_SIZE);
  const minTileY = Math.floor((centerY - overscanWorldHeight / 2) / TILE_SIZE);
  const maxTileY = Math.floor((centerY + overscanWorldHeight / 2) / TILE_SIZE);

  const tiles: Tile[] = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY >= 2 ** tileZoom) {
      continue;
    }
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedTileX = normalizeTileX(tileX, tileZoom);
      tiles.push({
        key: `${tileZoom}-${wrappedTileX}-${tileY}-${tileX}`,
        src: `https://tile.openstreetmap.org/${tileZoom}/${wrappedTileX}/${tileY}.png`,
        left: tileX * TILE_SIZE - centerX + width / 2,
        top: tileY * TILE_SIZE - centerY + height / 2,
      });
    }
  }

  return tiles;
}

export const MapComponent: FC<Props> = ({ asset, config }) => {
  const presetZoom = resolvePresetZoom(asset.detailLevel);
  const {
    lat: latitude,
    lon: longitude,
    zoomStart = presetZoom.start,
    zoomEnd = presetZoom.end,
    stillTime = 2,
    rotation = 4,
  } = asset.location;
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const isPortrait = height > width;
  const markerStyleConfig =
    config.styles?.all?.map?.marker ||
    (isPortrait
      ? config.styles?.portrait?.map?.marker
      : config.styles?.landscape?.map?.marker);
  const mapStyleConfig =
    config.styles?.all?.map ||
    (isPortrait ? config.styles?.portrait?.map : config.styles?.landscape?.map);
  const showLabel = Boolean(asset.showLabel && asset.label?.trim());

  const stillFrames = stillTime * fps;
  const currentZoom =
    stillFrames > durationInFrames
      ? zoomStart
      : interpolate(frame, [0, durationInFrames - stillFrames], [zoomStart, zoomEnd], {
          extrapolateRight: "clamp",
        });
  const currentRotation = interpolate(
    frame,
    [durationInFrames - stillFrames, durationInFrames],
    [0, rotation],
    {
      extrapolateRight: "clamp",
    }
  );

  const tileZoom = clamp(Math.round(zoomStart), MIN_TILE_ZOOM, MAX_TILE_ZOOM);
  const scaleStart = 2 ** (zoomStart - tileZoom);
  const scaleEnd = 2 ** (zoomEnd - tileZoom);
  const currentScale = 2 ** (currentZoom - tileZoom);
  const minScale = Math.min(scaleStart, scaleEnd);

  const tiles = useMemo(
    () => buildTiles(latitude, longitude, tileZoom, width, height, minScale),
    [height, latitude, longitude, minScale, tileZoom, width]
  );

  const markerColor = markerStyleConfig?.color || config.colors?.map?.marker || "#dd0000";
  const markerScale = markerStyleConfig?.scale || 2.5;

  return (
    <>
      <link rel="preconnect" href="https://tile.openstreetmap.org" crossOrigin="" />
      <AbsoluteFill
        style={{
          overflow: "hidden",
          backgroundColor: "#dfe7ef",
        }}
      >
        <AbsoluteFill
          style={{
            transform: `scale(${currentScale}) rotate(${Math.max(currentRotation, 0)}deg)`,
            transformOrigin: "50% 50%",
          }}
        >
          {tiles.map((tile) => (
            <Img
              key={tile.key}
              src={tile.src}
              style={{
                position: "absolute",
                left: tile.left,
                top: tile.top,
                width: TILE_SIZE,
                height: TILE_SIZE,
              }}
            />
          ))}
        </AbsoluteFill>

        <AbsoluteFill
          style={{
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              width: 16 * markerScale,
              height: 16 * markerScale,
              borderRadius: "999px",
              background: markerColor,
              border: `${Math.max(2, markerScale)}px solid rgba(255,255,255,0.95)`,
              boxShadow: "0 12px 28px rgba(0, 0, 0, 0.28)",
            }}
          />
        </AbsoluteFill>
      </AbsoluteFill>

      {showLabel ? (
        <AbsoluteFill
          style={{
            justifyContent: "flex-end",
            padding: isPortrait ? "0 40px 72px" : "0 56px 56px",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: isPortrait ? "78%" : "58%",
              borderRadius: 999,
              background: "rgba(15, 23, 42, 0.82)",
              color: "#ffffff",
              padding: isPortrait ? "16px 24px" : "14px 20px",
              fontSize: isPortrait ? 34 : 28,
              lineHeight: 1.15,
              fontWeight: 700,
              boxShadow: "0 24px 48px rgba(0, 0, 0, 0.28)",
              ...cssStringToReactStyle(mapStyleConfig?.labelContainer),
            }}
          >
            <span style={cssStringToReactStyle(mapStyleConfig?.labelText)}>
              {asset.label}
            </span>
          </div>
        </AbsoluteFill>
      ) : null}
    </>
  );
};
