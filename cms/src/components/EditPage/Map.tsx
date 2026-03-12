import {
  Map as MapComponent,
  Marker,
  NavigationControl,
  ScaleControl,
  type ViewState,
} from "react-map-gl/maplibre";
import { mapDetailLevelEnum } from "@videofy/types";
import "maplibre-gl/dist/maplibre-gl.css";
import type { StyleSpecification } from "maplibre-gl";
import { useEffect, useState, type CSSProperties } from "react";
import { z } from "zod";

interface Props {
  location?: {
    lat: number;
    lon: number;
  };
  zoom: number;
  label?: string;
  showLabel?: boolean;
  onEdit?: () => void;
  styles?: CSSProperties;
  onClick?: () => void;
  onLocationChange?: (location: { lat: number; lon: number }) => void;
  interactive?: boolean;
}

export type MapDetailLevel = z.infer<typeof mapDetailLevelEnum>;

export function getMapZoom(detailLevel?: MapDetailLevel): number {
  switch (detailLevel) {
    case "overview":
      return 6;
    case "close":
      return 14;
    case "standard":
    default:
      return 10;
  }
}

const DETAILED_OSM_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};
const DEFAULT_LOCATION = {
  lat: 59.9139,
  lon: 10.7522,
};

const MapComp = ({
  location,
  zoom,
  label,
  showLabel,
  onEdit,
  styles,
  onClick = () => {},
  onLocationChange,
  interactive = true,
}: Props) => {
  const hasLocation =
    typeof location?.lat === "number" &&
    Number.isFinite(location.lat) &&
    typeof location?.lon === "number" &&
    Number.isFinite(location.lon);
  const mapLocation = hasLocation ? location : DEFAULT_LOCATION;
  const [viewState, setViewState] = useState<ViewState>({
    longitude: mapLocation.lon,
    latitude: mapLocation.lat,
    zoom,
    bearing: 0,
    pitch: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  useEffect(() => {
    setViewState((current) => ({
      ...current,
      longitude: mapLocation.lon,
      latitude: mapLocation.lat,
    }));
  }, [mapLocation.lat, mapLocation.lon]);

  useEffect(() => {
    setViewState((current) => ({
      ...current,
      zoom,
    }));
  }, [zoom]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <link rel="preconnect" href="https://tile.openstreetmap.org" crossOrigin="" />

      <MapComponent
        interactive={interactive}
        {...viewState}
        onMove={(event) => {
          setViewState(event.viewState);
        }}
        onClick={(event) => {
          onClick();
          if (!interactive || !onLocationChange) {
            return;
          }
          setViewState((current) => ({
            ...current,
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
          }));
          onLocationChange({
            lat: event.lngLat.lat,
            lon: event.lngLat.lng,
          });
        }}
        attributionControl={false}
        maxZoom={19}
        minZoom={2}
        dragRotate={false}
        pitchWithRotate={false}
        scrollZoom={interactive}
        doubleClickZoom={interactive}
        touchZoomRotate={interactive}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "0.5rem",
          aspectRatio: "16/9",
          cursor: interactive && onLocationChange ? "crosshair" : "pointer",
          ...styles,
        }}
        mapStyle={DETAILED_OSM_STYLE}
      >
        {interactive ? (
          <>
            <NavigationControl position="top-left" showCompass={false} />
            <ScaleControl position="bottom-left" />
          </>
        ) : null}
        {hasLocation && (
          <Marker
            longitude={location.lon}
            latitude={location.lat}
            color="#dd0000"
            draggable={interactive && Boolean(onLocationChange)}
            onDragEnd={(event) => {
              setViewState((current) => ({
                ...current,
                longitude: event.lngLat.lng,
                latitude: event.lngLat.lat,
              }));
              onLocationChange?.({
                lat: event.lngLat.lat,
                lon: event.lngLat.lng,
              });
            }}
          />
        )}
        {!!onEdit && (
          <button
            type="button"
            className="top-2 right-2 z-10 absolute bg-white hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 shadow-md p-2 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-black dark:focus:ring-gray-800 focus:ring-offset-2 text-black dark:text-gray-200"
            onClick={() => onEdit()}
            aria-label="Activate map"
          >
            Edit map
          </button>
        )}
      </MapComponent>
      {showLabel && label ? (
        <div
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 16,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              maxWidth: "100%",
              borderRadius: 999,
              background: "rgba(15, 23, 42, 0.82)",
              color: "#fff",
              padding: "8px 14px",
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.2,
              boxShadow: "0 10px 30px rgba(0, 0, 0, 0.24)",
            }}
          >
            {label}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MapComp;
