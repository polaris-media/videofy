import { Button, Tooltip } from "antd";
import { EditOutlined } from "@ant-design/icons";
import { FC } from "react";

interface Props {
  onClick: () => void;
  tooltipText: string;
}

const EditAssetButton: FC<Props> = ({ onClick, tooltipText }) => {
  return (
    <Tooltip title={tooltipText}>
      <div className="top-1 right-1 absolute">
        <Button shape="circle" icon={<EditOutlined />} onClick={onClick} />
      </div>
    </Tooltip>
  );
};

export default EditAssetButton;
