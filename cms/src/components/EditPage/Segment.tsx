"use client";
import { Bars3Icon } from "@heroicons/react/20/solid";
import {
  Button,
  Card,
  Col,
  Flex,
  Form,
  Input,
  Row,
  Select,
  Tooltip,
} from "antd";
import { CopyOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { cameraMovements, moods, textPlacements } from "@/utils/constants";
import { FC } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import MediaAsset from "./MediaAsset";
import AudioRecorder from "../AudioRecorder/AudioRecorder";

interface SegmentProps {
  id: string;
  position: number;
  onDuplicate: () => void;
  onRemove: () => void;
  onAdd: () => void;
  manuscriptIndex: number;
}

const Segment: FC<SegmentProps> = ({
  id,
  manuscriptIndex,
  position,
  onAdd,
  onDuplicate,
  onRemove,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    width: "100%",
  };
  const form = Form.useFormInstance();
  const allMedia = form.getFieldValue([
    "tabs",
    manuscriptIndex,
    "manuscript",
    "media",
  ]);
  return (
    <div ref={setNodeRef} style={style}>
      <Card key={id} className="w-full" classNames={{ body: "pb-0" }}>
        <Flex align="top" gap="large" justify="space-between">
          <Flex
            vertical
            justify="center"
            align="center"
            {...attributes}
            {...listeners}
          >
            <Bars3Icon
              className="w-5 h-5 dark:text-gray-100 cursor-move"
              aria-hidden="true"
            />
          </Flex>

          <Form.Item name={[position, "mainMedia"]} className="w-[250px]">
            <MediaAsset allMedia={allMedia} />
          </Form.Item>

          <Flex vertical flex="auto">
            <Row>
              <Col span={24}>
                <Form.Item>
                  <Form.Item noStyle name={[position, "text"]}>
                    <Input.TextArea style={{ width: "100%" }} rows={5} />
                  </Form.Item>
                  <div className="mt-1 text-[12px] text-gray-500">
                    Add pronunciation hints in [brackets] after words
                  </div>
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={8} key="mood">
                <Form.Item label="Mood" name={[position, "mood"]}>
                  <Select
                    options={moods.map((m) => ({
                      value: m.id,
                      label: m.name,
                    }))}
                    popupMatchSelectWidth={false}
                  />
                </Form.Item>
              </Col>
              <Col span={8} key="cameraMovement">
                <Form.Item label="Camera" name={[position, "cameraMovement"]}>
                  <Select
                    options={cameraMovements.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                    popupMatchSelectWidth={false}
                  />
                </Form.Item>
              </Col>
              <Col span={8} key="placement">
                <Form.Item label="Placement" name={[position, "style"]}>
                  <Select
                    options={textPlacements.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                    popupMatchSelectWidth={false}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row>
              <Form.Item
                name={[position, "customAudio"]}
                label="Custom audio"
                className="w-full"
              >
                <AudioRecorder />
              </Form.Item>
            </Row>
          </Flex>
          <Form.Item>
            <Flex vertical gap="small">
              <Tooltip title="Add segment below">
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={onAdd}
                />
              </Tooltip>
              <Tooltip title="Duplicate segment">
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={onDuplicate}
                />
              </Tooltip>
              <Tooltip title="Delete segment">
                <Button
                  danger
                  type="primary"
                  icon={<DeleteOutlined />}
                  onClick={onRemove}
                />
              </Tooltip>
            </Flex>
          </Form.Item>
        </Flex>
      </Card>
    </div>
  );
};

export default Segment;
