/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React from "react";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button, Tabs, Tooltip } from "antd";
import type { TabsProps as AntTabsProps } from "antd";
import { PlusOutlined } from "@ant-design/icons";

interface DraggableTabNodeProps extends React.HTMLAttributes<HTMLDivElement> {
  "data-node-key": string;
}

const DraggableTabNode: React.FC<Readonly<DraggableTabNodeProps>> = (props) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({
      id: props["data-node-key"],
    });

  const style: React.CSSProperties = {
    ...props.style,
    transform: CSS.Translate.toString(transform),
    transition,
    cursor: "move",
  };

  return React.cloneElement(props.children as React.ReactElement<any>, {
    ref: setNodeRef,
    style,
    ...attributes,
    ...listeners,
  });
};

interface SortableTabsProps extends Omit<AntTabsProps, "items"> {
  items: NonNullable<AntTabsProps["items"]>;
  onReorder: (from: number, to: number) => void;
  onAdd?: () => void;
  allowAdd?: boolean;
}

const SortableTabs: React.FC<Readonly<SortableTabsProps>> = ({
  items,
  onReorder,
  onChange,
  onAdd,
  allowAdd = true,
  ...restProps
}) => {
  const sensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 10 },
  });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (active.id !== over?.id && items) {
      const activeIndex = items.findIndex((i) => i.key === active.id);
      const overIndex = items.findIndex((i) => i.key === over?.id);
      if (activeIndex !== -1 && overIndex !== -1) {
        onReorder(activeIndex, overIndex);
      }
    }
  };

  return (
    <Tabs
      tabBarExtraContent={
        allowAdd ? (
          <Tooltip title="Add article" placement="left">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onAdd}
              className="inline-flex"
            />
          </Tooltip>
        ) : null
      }
      style={{ marginTop: 0 }}
      {...restProps}
      items={items}
      onChange={onChange} // Pass AntD's onChange to the Tabs component
      renderTabBar={(tabBarProps, DefaultTabBar) => (
        <DndContext
          sensors={[sensor]}
          onDragEnd={onDragEnd}
          collisionDetection={closestCenter}
        >
          <SortableContext
            items={items.map((i) => i.key)}
            strategy={horizontalListSortingStrategy}
          >
            <DefaultTabBar {...tabBarProps}>
              {(node) => (
                <DraggableTabNode
                  {...(node as React.ReactElement<DraggableTabNodeProps>).props}
                  key={node.key}
                >
                  {node}
                </DraggableTabNode>
              )}
            </DefaultTabBar>
          </SortableContext>
        </DndContext>
      )}
    />
  );
};

export default SortableTabs;
