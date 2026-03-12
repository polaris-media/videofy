import { MediaAssetType, VideoType } from "@videofy/types";
import { Button, Form, Input, Modal, Space, Tooltip, Typography } from "antd";
import { FormInstance, useForm } from "antd/es/form/Form";
import React, { FC, useEffect, useMemo } from "react";
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import ReplaceMedia from "./ReplaceMedia";
import SvpVideoPicker from "./SvpVideoPicker";
import { useGlobalState } from "@/state/globalState";

function convertToSeconds(timeStr: string): number {
  const [hh = "0", mm = "0", ss = "0"] = timeStr.split(":");
  return Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
}

function convertToFriendlyValue(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

type FormType = {
  start: string;
  end: string;
  byline?: string;
};

function validateTimeInput(
  value: string,
  fieldName: string,
  duration: number,
  form: FormInstance<FormType>
): void {
  if (!value) {
    throw new Error(`Please enter a ${fieldName} time.`);
  }

  const pattern =
    /^(\d{1,2}:\d{2}(\.\d{1,2})?|\d{1,2}:\d{2}:\d{2}(\.\d{1,2})?)$/;
  if (!pattern.test(value)) {
    throw new Error("Invalid time format. Use M:SS.SS or H:MM:SS.SS");
  }

  const timeInSeconds = convertToSeconds(value);
  if (timeInSeconds < 0) {
    throw new Error("Time cannot be negative.");
  }
  if (timeInSeconds > duration) {
    throw new Error(
      `Time cannot be greater than video duration (${convertToFriendlyValue(duration)})`
    );
  }

  const startTime = convertToSeconds(form.getFieldValue("start") || "0");
  const endTime = convertToSeconds(form.getFieldValue("end") || "0");
  if (startTime > endTime) {
    throw new Error("Start time cannot be greater than end time");
  }
}

type TimeInputProps = {
  fieldName: keyof FormType;
  form: FormInstance<FormType>;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration: number;
};

const TimeInputWithButtons: FC<TimeInputProps> = ({
  fieldName,
  form,
  videoRef,
  duration,
}) => {
  const handleSetToCurrent = () => {
    if (!videoRef.current) return;
    const currentTime = videoRef.current.currentTime;
    const timeToSet = currentTime > duration ? duration : currentTime;
    form.setFieldsValue({
      [fieldName]: convertToFriendlyValue(timeToSet),
    });
  };

  const handleSetVideoToPosition = () => {
    if (!videoRef.current) return;
    const timeValue = form.getFieldValue(fieldName);
    if (!timeValue) return;
    videoRef.current.currentTime = convertToSeconds(timeValue);
  };

  return (
    <Space.Compact style={{ width: "100%" }}>
      <Form.Item
        name={fieldName}
        noStyle
        rules={[
          {
            validator: async (_, value) => {
              await validateTimeInput(value, fieldName, duration, form);
            },
          },
        ]}
      >
        <Input placeholder="i.e. 2:01.25 or 2:05:04" />
      </Form.Item>
      <Tooltip title="Set to current video position">
        <Button icon={<ArrowDownOutlined />} onClick={handleSetToCurrent} />
      </Tooltip>
      <Tooltip title="Set video to this position">
        <Button icon={<ArrowUpOutlined />} onClick={handleSetVideoToPosition} />
      </Tooltip>
    </Space.Compact>
  );
};

const EditVideo = ({
  video,
  onClose,
  onSave,
  alternativeMedia = [],
}: {
  video?: VideoType;
  onClose: () => void;
  onSave: (asset?: MediaAssetType) => void;
  alternativeMedia?: MediaAssetType[];
}) => {
  const { selectedProject, config } = useGlobalState();
  const [form] = useForm<FormType>();
  const [replaceForm] = useForm<{ videoUrl?: string }>();

  useEffect(() => {
    if (!video) return;
    form.setFieldsValue({
      start: convertToFriendlyValue(video.startFrom || 0),
      end: convertToFriendlyValue(
        video.endAt || (video.videoAsset.duration || 0) / 1000
      ),
      byline: video.byline,
    });
  }, [video, form]);

  const handleTrimSave = ({ start, end, byline }: FormType) => {
    const updatedVideo: VideoType | undefined = video && {
      ...video,
      startFrom: convertToSeconds(start),
      endAt: convertToSeconds(end),
      byline,
    };
    onSave(updatedVideo);
    onClose();
  };

  const handleReplaceWithUrl = async ({ videoUrl }: { videoUrl?: string }) => {
    if (!videoUrl) return;
    const newVideo: VideoType = {
      type: "video",
      url: videoUrl,
      videoAsset: {
        id: crypto.randomUUID(),
        title: "Local video",
        streamUrls: {
          mp4: videoUrl,
        },
      },
    };
    onSave(newVideo);
    onClose();
  };

  const videoRef = useMemo(() => React.createRef<HTMLVideoElement>(), []);
  const duration = (video?.videoAsset.duration || 0) / 1000;
  const projectId = selectedProject?.id || config?.projectId;

  return (
    <Modal open onCancel={onClose} onOk={form.submit}>
      {video && (
        <Form form={form} onFinish={handleTrimSave} layout="vertical">
          <Form.Item>
            <video
              controls={true}
              muted={true}
              className="rounded-lg"
              draggable="false"
              key={video.url}
              ref={videoRef}
            >
              <source src={video.url} type="video/mp4" />
            </video>
          </Form.Item>
          <Form.Item label="Start at (M.SS.SS, i.e. 10:12.25)">
            <TimeInputWithButtons
              fieldName="start"
              form={form}
              videoRef={videoRef}
              duration={duration}
            />
          </Form.Item>
          <Form.Item label="End at (M.SS.SS, i.e. 10:12.25)">
            <TimeInputWithButtons
              fieldName="end"
              form={form}
              videoRef={videoRef}
              duration={duration}
            />
          </Form.Item>
          <Form.Item name="byline" label="Byline">
            <Input />
          </Form.Item>
        </Form>
      )}

      <Typography.Text strong>Replace video by URL</Typography.Text>
      <Form<{ videoUrl?: string }>
        form={replaceForm}
        layout="vertical"
        onFinish={handleReplaceWithUrl}
      >
        <Form.Item
          label="Video URL"
          name="videoUrl"
          rules={[{ required: true, message: "Please enter a local video URL" }]}
        >
          <Input placeholder="http://127.0.0.1:8001/projects/<id>/files/input/videos/file.mp4" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit">
            Use URL
          </Button>
        </Form.Item>
      </Form>

      <ReplaceMedia
        alternativeMedia={alternativeMedia}
        externalLibraryLabel="Stream video library"
        externalLibrary={
          <SvpVideoPicker
            projectId={projectId}
            onSelect={(selectedAsset) => {
              onSave(selectedAsset);
              onClose();
            }}
          />
        }
        onSelectMedia={(selectedAsset) => {
          onSave(selectedAsset);
          onClose();
        }}
      />
    </Modal>
  );
};

export default EditVideo;
