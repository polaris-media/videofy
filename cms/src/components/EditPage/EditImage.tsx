import { ImageType, MediaAssetType } from "@videofy/types";
import { useReactive } from "ahooks";
import { Button, Form, Input, Modal, Upload } from "antd";
import { useForm } from "antd/es/form/Form";
import { useMemo } from "react";
import ReactCrop, {
  convertToPercentCrop,
  convertToPixelCrop,
  PercentCrop,
  PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { LoadingOutlined, UploadOutlined } from "@ant-design/icons";
import ReplaceMedia from "./ReplaceMedia";
import { useGlobalState } from "@/state/globalState";

const CropControl = ({
  image,
  value,
  onChange,
}: {
  image: ImageType;
  value?: PercentCrop;
  onChange?: (value: PercentCrop) => void;
}) => {
  const handleChange = (crop: PixelCrop, percentCrop: PercentCrop) => {
    if (onChange) onChange(percentCrop);
  };

  return (
    <ReactCrop crop={value} onChange={handleChange}>
      <img
        src={image.url}
        width={image.imageAsset.size.width}
        height={image.imageAsset.size.height}
        alt=""
        style={{ maxWidth: "100%", height: "auto" }}
      />
    </ReactCrop>
  );
};

const EditImage = ({
  image,
  onClose,
  onSave,
  alternativeMedia,
}: {
  image?: ImageType;
  onClose: () => void;
  onSave: (asset: MediaAssetType) => void;
  alternativeMedia?: MediaAssetType[];
}) => {
  const initialValues = useMemo(
    () => ({
      crop:
        image?.hotspot &&
        convertToPercentCrop(
          image.hotspot,
          image.imageAsset.size.width,
          image.imageAsset.size.height
        ),
      byline: image?.byline,
      loading: false,
    }),
    [image]
  );
  const [form] = useForm();
  const state = useReactive({ loading: false });
  const { generationId } = useGlobalState();

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    state.loading = true;
    const formData = new FormData();

    formData.append("file", file);

    try {
      if (!generationId) {
        throw new Error("No active project selected.");
      }

      const data = await fetch(
        `/api/uploadImage?projectId=${encodeURIComponent(generationId)}`,
        {
        method: "POST",
        body: formData,
      });

      if (!data.ok) return alert("Failed to upload image");

      const result = await data.json();

      const newImage: ImageType = {
        type: "image",
        url: result.url,
        imageAsset: {
          id: "1",
          size: {
            height: result.image.height,
            width: result.image.width,
          },
        },
      };
      onSave(newImage);
      return false;
    } catch (e) {
      console.error(e);
      alert("Failed to upload image");
    } finally {
      state.loading = false;
    }
  };

  type FormType = {
    crop?: PercentCrop;
    byline?: string;
  };

  const handleClose = ({ crop, byline }: FormType) => {
    if (image) {
      const updatedImage = {
        ...image,
        hotspot: convertToPixelCrop(
          crop || {},
          image.imageAsset.size.width,
          image.imageAsset.size.height
        ),
        byline,
      };
      onSave(updatedImage);
    }
    onClose();
  };

  return (
    <Modal
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Save"
      cancelText="Close"
    >
      <Form
        form={form}
        onFinish={handleClose}
        initialValues={initialValues}
        layout="vertical"
      >
        {image && (
          <>
            <Form.Item
              name="crop"
              label="Select a hotspot (an area to be centered in the image)"
            >
              <CropControl image={image} />
            </Form.Item>
            <Form.Item name="byline" label="Byline">
              <Input />
            </Form.Item>
          </>
        )}

        <Form.Item
          shouldUpdate
          label={image ? "Replace image" : "Upload image"}
          rules={[{ required: true }]}
        >
          <Upload
            id="file"
            accept="image/*"
            beforeUpload={handleFileUpload}
            fileList={[]}
          >
            <Button
              disabled={state.loading}
              icon={
                state.loading ? <LoadingOutlined spin /> : <UploadOutlined />
              }
            >
              {state.loading ? "Uploading image" : "Click to upload"}
            </Button>
          </Upload>
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

export default EditImage;
