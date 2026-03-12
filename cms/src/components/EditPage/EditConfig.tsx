import React, { useEffect } from "react";
import { useReactive } from "ahooks";
import { Tabs, Input, Button, Upload, Alert, App, Empty, Flex, Spin } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { LoadingOutlined, UploadOutlined } from "@ant-design/icons";
import { type Config, appConfigSchema } from "@videofy/types";
import { useProjectAssets } from "@/api";
import { useGlobalState } from "../../state/globalState";
import { saveConfig as saveConfigAction } from "@/actions/configActions";

const { TextArea } = Input;

const EditConfig: React.FC = () => {
  const { config, setConfig, selectedProject } = useGlobalState();
  const { message } = App.useApp();
  const state = useReactive({
    currentConfigString: JSON.stringify(config.config, null, 2),
    validationError: null as string | null,
    savingConfig: false,
    saveSuccessMessage: null as string | null,
    uploading: false,
  });

  const {
    data: projectAssetsResponse,
    error: projectAssetsError,
    isLoading: projectAssetsLoading,
    refresh: refreshAssets,
  } = useProjectAssets(selectedProject?.id);

  const projectFiles = projectAssetsResponse?.files || [];

  useEffect(() => {
    state.currentConfigString = JSON.stringify(config.config, null, 2);
  }, [config, state]);

  if (!selectedProject) {
    return null;
  }

  const handleSaveConfig = async () => {
    state.validationError = null;
    state.saveSuccessMessage = null;
    state.savingConfig = true;

    let parsedConfigData: Config;
    try {
      parsedConfigData = JSON.parse(state.currentConfigString);
      const validationResult = appConfigSchema.safeParse(parsedConfigData);
      if (!validationResult.success) {
        state.validationError = `Invalid config format: ${validationResult.error.issues
          .map((issue) => `${issue.path.join(".")} - ${issue.message}`)
          .join(", ")}`;
        state.savingConfig = false;
        return;
      }
      parsedConfigData = validationResult.data;
    } catch (error) {
      if (error instanceof SyntaxError) {
        state.validationError = `Invalid JSON: ${error.message}`;
      } else {
        state.validationError =
          "An unexpected error occurred during local validation.";
        console.error("Error parsing config JSON locally:", error);
      }
      state.savingConfig = false;
      return;
    }

    try {
      const result = await saveConfigAction({
        projectId: selectedProject.id,
        config: parsedConfigData,
      });
      if (result.success) {
        setConfig({ projectId: selectedProject.id, config: parsedConfigData });
        state.saveSuccessMessage =
          result.message || "Config saved successfully!";
      } else {
        state.validationError =
          result.error || "Failed to save config to server.";
      }
    } catch (serverError) {
      console.error("Error calling saveConfig action:", serverError);
      state.validationError =
        "An unexpected error occurred while saving to the server.";
    } finally {
      state.savingConfig = false;
    }
  };

  const handleUpload = async (file: UploadFile) => {
    if (!selectedProject?.id || !file.name) {
      console.error("Project or file name is missing");
      return "error";
    }
    state.uploading = true;
    const formData = new FormData();
    formData.append("file", file as unknown as Blob);

    try {
      const response = await fetch(`/api/assets/${selectedProject.id}`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `Failed to upload file: ${response.statusText}`
        );
      }

      await refreshAssets();
      state.uploading = false;
      return "success";
    } catch (error) {
      console.error("Error uploading file:", error);
      state.uploading = false;
      return "error";
    }
  };

  return (
    <Tabs
      defaultActiveKey="config"
      items={[
        {
          key: "config",
          label: "Edit Config",
          children: (
            <>
              <TextArea
                rows={15}
                value={state.currentConfigString}
                onChange={(e) => {
                  state.currentConfigString = e.target.value;
                  state.validationError = null;
                }}
                style={{ marginBottom: "1rem" }}
              />
              {state.validationError && (
                <Alert
                  title={state.validationError}
                  type="error"
                  showIcon
                  style={{ marginBottom: "1rem" }}
                />
              )}
              {state.saveSuccessMessage && (
                <Alert
                  title={state.saveSuccessMessage}
                  type="success"
                  showIcon
                  closable
                  onClose={() => (state.saveSuccessMessage = null)}
                  style={{ marginBottom: "1rem" }}
                />
              )}
              <Button
                type="primary"
                onClick={handleSaveConfig}
                loading={state.savingConfig}
              >
                Save Config
              </Button>
            </>
          ),
        },
        {
          key: "assets",
          label: "Upload Assets",
          children: (
            <>
              <Upload
                customRequest={({ file, onSuccess, onError }) => {
                  handleUpload(file as UploadFile)
                    .then((result) => {
                      if (result === "success" && onSuccess) {
                        onSuccess({}, new XMLHttpRequest());
                      } else if (result === "error" && onError) {
                        onError(new Error("Upload failed"));
                      }
                    })
                    .catch((err) => {
                      if (onError) onError(err);
                    });
                }}
                showUploadList={false}
              >
                <Button
                  icon={
                    state.uploading ? (
                      <LoadingOutlined spin />
                    ) : (
                      <UploadOutlined />
                    )
                  }
                  loading={state.uploading}
                  disabled={state.uploading}
                >
                  {state.uploading ? "Uploading..." : "Upload media"}
                </Button>
              </Upload>

              {projectAssetsError && (
                <Alert
                  title={`Failed to load project assets: ${projectAssetsError.message}`}
                  type="error"
                  style={{ marginTop: "1rem", marginBottom: "1rem" }}
                  showIcon
                />
              )}

              <div
                style={{
                  marginTop: "1rem",
                  border: "1px solid #303030",
                  borderRadius: 8,
                  padding: "0.75rem 1rem",
                  minHeight: 96,
                }}
              >
                {projectAssetsLoading ? (
                  <Flex align="center" justify="center" style={{ minHeight: 64 }}>
                    <Spin size="small" />
                  </Flex>
                ) : projectFiles.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No uploaded project assets yet"
                  />
                ) : (
                  <Flex vertical gap="small">
                    {projectFiles.map((item) => (
                      <div
                        key={item}
                        style={{
                          fontFamily: "monospace",
                          fontSize: 13,
                          lineHeight: 1.5,
                          wordBreak: "break-all",
                        }}
                      >
                        {item}
                      </div>
                    ))}
                  </Flex>
                )}
              </div>
            </>
          ),
        },
      ]}
      onChange={() => {
        if (state.saveSuccessMessage) {
          message.destroy();
        }
      }}
    />
  );
};

export default EditConfig;
