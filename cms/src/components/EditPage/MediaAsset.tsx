"use client";

import { Button, Dropdown, Flex, Image, MenuProps, Space } from "antd";
import { ImageType, MapType, MediaAssetType, VideoType } from "@videofy/types";
import EditAssetButton from "./EditAssetButton";
import EditImage from "./EditImage";
import { useReactive } from "ahooks";
import EditVideo from "./EditVideo";
import MapComponent, { getMapZoom } from "./Map";
import EditMap from "./EditMap";
import { FC } from "react";
import {
  CaretRightOutlined,
  CloseSquareOutlined,
  DownOutlined,
  PictureOutlined,
} from "@ant-design/icons";

interface MediaAssetProps {
  value?: MediaAssetType;
  onChange?: (value?: MediaAssetType) => void;
  allMedia?: MediaAssetType[];
  editable?: boolean;
}

const MediaAsset: FC<MediaAssetProps> = ({
  value,
  onChange = () => {},
  allMedia = [],
  editable = true,
}) => {
  const state = useReactive({
    isEditAssetOpen: false,
    addType: undefined as string | undefined,
  });

  function handleChange(newValue: MediaAssetType | undefined) {
    onChange(newValue);
    state.addType = undefined;
  }

  function handleClose() {
    state.isEditAssetOpen = false;
    state.addType = undefined;
  }

  const mediaMenu = [
    {
      key: "image",
      label: "Image",
      icon: <PictureOutlined />,
    },
    {
      key: "video",
      label: "Video",
      icon: <CaretRightOutlined />,
    },
    {
      key: "map",
      label: "Map",
      icon: <CloseSquareOutlined />,
    },
  ];

  const handleAddMenuClick: MenuProps["onClick"] = (clickedItem) => {
    state.addType = clickedItem.key;
    state.isEditAssetOpen = true;
  };

  const handleReplaceMenuClick: MenuProps["onClick"] = (clickedItem) => {
    onChange(undefined);
    state.addType = clickedItem.key;
    state.isEditAssetOpen = true;
  };

  return (
    <div className="w-full aspect-square text-center">
      {!value && (
        <div className="relative w-full aspect-square">
          <Flex
            vertical
            align="center"
            justify="center"
            className="inset-0 h-full"
          >
            <Dropdown menu={{ items: mediaMenu, onClick: handleAddMenuClick }}>
              <Button type="primary">
                <Space>
                  Add media
                  <DownOutlined />
                </Space>
              </Button>
            </Dropdown>
          </Flex>
        </div>
      )}
      {value?.type === "image" && (
        <>
          <Image
            key={value.imageAsset.id}
            className="rounded-xl w-full object-cover aspect-square"
            src={value.url}
          />
          {editable && (
            <EditAssetButton
              onClick={() => (state.isEditAssetOpen = true)}
              tooltipText="Edit image"
            />
          )}
        </>
      )}
      {value?.type === "video" && (
        <>
          <div key={value.videoAsset.id}>
            <video
              controls={true}
              className="rounded-xl w-full object-cover aspect-square cursor-pointer"
              draggable="false"
              onClick={() => (state.isEditAssetOpen = true)}
            >
              <source src={value?.url} type="video/mp4" />
              Your browser does not support the video tag.
            </video>
            {editable && (
              <EditAssetButton
                onClick={() => (state.isEditAssetOpen = true)}
                tooltipText="Edit video"
              />
            )}
          </div>
        </>
      )}
      {value?.type === "map" && (
        <>
          <div
            className="relative"
            key={value.location.lat + value.location.lon}
          >
            <div className="w-full">
              <MapComponent
                onClick={() => (state.isEditAssetOpen = true)}
                location={value.location}
                zoom={getMapZoom(value.detailLevel)}
                label={value.label}
                showLabel={value.showLabel}
                interactive={false}
              />
            </div>
            <EditAssetButton
              onClick={() => (state.isEditAssetOpen = true)}
              tooltipText="Edit map"
            />
          </div>
        </>
      )}
      {value?.type && editable && (
        <Dropdown
          menu={{ items: mediaMenu, onClick: handleReplaceMenuClick }}
          className="mt-2"
        >
          <Button type="default" size="small">
            <Space>
              Replace with...
              <DownOutlined />
            </Space>
          </Button>
        </Dropdown>
      )}
      {state.isEditAssetOpen && (
        <>
          {(value?.type === "image" || state.addType === "image") && (
            <EditImage
              image={value as unknown as ImageType}
              onClose={handleClose}
              onSave={handleChange}
              alternativeMedia={allMedia}
            />
          )}
          {(value?.type === "video" || state.addType === "video") && (
            <EditVideo
              video={value as unknown as VideoType}
              onClose={handleClose}
              onSave={handleChange}
              alternativeMedia={allMedia}
            />
          )}
          {(value?.type === "map" || state.addType === "map") && (
            <EditMap
              map={value as unknown as MapType}
              onClose={handleClose}
              onSave={handleChange}
              alternativeMedia={allMedia}
            />
          )}
        </>
      )}
    </div>
  );
};

export default MediaAsset;
