import { MapType, MediaAssetType } from "@videofy/types";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Typography } from "antd";
import { useForm } from "antd/es/form/Form";
import { useEffect, useState } from "react";
import Map, { getMapZoom, type MapDetailLevel } from "./Map";
import ReplaceMedia from "./ReplaceMedia";

const EditMap = ({
  map,
  onClose,
  onSave,
  alternativeMedia = [],
}: {
  map?: MapType;
  onClose: () => void;
  onSave: (asset?: MediaAssetType) => void;
  alternativeMedia?: MediaAssetType[];
}) => {
  const [form] = useForm();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; label: string; lat: number; lon: number }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  type FormType = {
    lat: number;
    lon: number;
    label?: string;
    showLabel?: boolean;
    detailLevel?: MapDetailLevel;
  };

  useEffect(() => {
    setSearchResults([]);
    setSearchError(null);
  }, []);

  const handleFinish = ({
    lat,
    lon,
    label,
    showLabel,
    detailLevel,
  }: FormType) => {
    const trimmedLabel = label?.trim();
    const nextLocation = map
      ? {
          lat,
          lon,
          stillTime: map.location.stillTime,
          rotation: map.location.rotation,
        }
      : { lat, lon };
    const newMap: MapType = map
      ? {
          ...map,
          location: nextLocation,
          label: trimmedLabel || undefined,
          showLabel: Boolean(showLabel && trimmedLabel),
          detailLevel: detailLevel || "standard",
        }
      : {
          type: "map",
          location: nextLocation,
          label: trimmedLabel || undefined,
          showLabel: Boolean(showLabel && trimmedLabel),
          detailLevel: detailLevel || "standard",
        };
    onSave(newMap);
    onClose();
  };

  const handleSearch = async () => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchError("Skriv minst to tegn for å søke etter et sted.");
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const payload = await response.text();
        throw new Error(payload || "Kunne ikke søke etter sted.");
      }

      const payload = (await response.json()) as {
        items?: Array<{ id: string; label: string; lat: number; lon: number }>;
      };

      setSearchResults(payload.items || []);
      if (!payload.items?.length) {
        setSearchError("Ingen steder ble funnet for søket.");
      }
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : "Kunne ikke søke etter sted.");
    } finally {
      setSearchLoading(false);
    }
  };

  return (
    <Modal
      open
      title="Velg kartposisjon"
      width={760}
      style={{ top: 24 }}
      styles={{ body: { maxHeight: "72vh", overflowY: "auto" } }}
      onCancel={onClose}
      onOk={() => form.submit()}
    >
      <Form
        form={form}
        onFinish={handleFinish}
        initialValues={{
          ...map?.location,
          label: map?.label,
          showLabel: map?.showLabel ?? Boolean(map?.label),
          detailLevel: map?.detailLevel || "standard",
        }}
        layout="vertical"
      >
        <Alert
          showIcon
          type="info"
          title="Klikk, dra og zoom i kartet"
          description="Kartet bruker nå OpenStreetMap med flere stedsnavn. Søk etter et sted, eller klikk, dra og zoom i kartet for å sette posisjon."
          style={{ marginBottom: 16 }}
        />
        <Form.Item label="Søk sted" style={{ marginBottom: 12 }}>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={searchQuery}
              placeholder="Søk etter by, adresse eller stednavn"
              onChange={(event) => setSearchQuery(event.target.value)}
              onPressEnter={() => void handleSearch()}
            />
            <Button onClick={() => void handleSearch()} loading={searchLoading}>
              Søk
            </Button>
          </Space.Compact>
        </Form.Item>
        {searchError ? (
          <Alert
            showIcon
            type="info"
            title={searchError}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {searchResults.length > 0 ? (
          <div
            style={{
              marginBottom: 16,
              maxHeight: 200,
              overflow: "auto",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
            }}
          >
            {searchResults.map((item, index) => (
              <button
                key={item.id}
                type="button"
                style={{
                  cursor: "pointer",
                  width: "100%",
                  padding: "10px 12px",
                  textAlign: "left",
                  border: "none",
                  borderBottom:
                    index < searchResults.length - 1
                      ? "1px solid rgba(255,255,255,0.08)"
                      : "none",
                  background: "transparent",
                }}
                onClick={() => {
                  form.setFieldsValue({
                    lat: item.lat,
                    lon: item.lon,
                    label: form.getFieldValue("label") || item.label,
                    showLabel: form.getFieldValue("showLabel") ?? true,
                  });
                  setSearchQuery(item.label);
                }}
              >
                <Typography.Text>{item.label}</Typography.Text>
                <div>
                  <Typography.Text type="secondary">
                    {item.lat.toFixed(5)}, {item.lon.toFixed(5)}
                  </Typography.Text>
                </div>
              </button>
            ))}
          </div>
        ) : null}
        <Form.Item shouldUpdate>
          {() => (
            <div
              key={`${form.getFieldValue("lat")}+${form.getFieldValue("lon")}`}
            >
              <Map
                location={form.getFieldsValue(["lat", "lon"])}
                zoom={getMapZoom(form.getFieldValue("detailLevel"))}
                label={form.getFieldValue("label")}
                showLabel={form.getFieldValue("showLabel")}
                styles={{ minHeight: 360, aspectRatio: "auto" }}
                onLocationChange={(location) => {
                  form.setFieldsValue(location);
                }}
              />
            </div>
          )}
        </Form.Item>
        <Form.Item name="label" label="Stedsnavn på kartet">
          <Input placeholder="For eksempel Hovden sentrum" />
        </Form.Item>
        <Form.Item
          name="showLabel"
          label="Vis stedsnavn i videoen"
          valuePropName="checked"
        >
          <Switch />
        </Form.Item>
        <Form.Item name="detailLevel" label="Detaljnivå">
          <Select
            options={[
              { value: "overview", label: "Oversikt" },
              { value: "standard", label: "Standard" },
              { value: "close", label: "Nært" },
            ]}
          />
        </Form.Item>
        <Form.Item name="lat" label="Latitude" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} step={0.000001} />
        </Form.Item>
        <Form.Item name="lon" label="Longitude" rules={[{ required: true }]}>
          <InputNumber style={{ width: "100%" }} step={0.000001} />
        </Form.Item>
        <ReplaceMedia
          alternativeMedia={alternativeMedia}
          onSelectMedia={(selectedAsset) => {
            onSave(selectedAsset);
          }}
        />
      </Form>
    </Modal>
  );
};

export default EditMap;
