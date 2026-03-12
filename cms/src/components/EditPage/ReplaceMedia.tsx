import { MediaAssetType } from "@videofy/types";
import { Alert, Button, Collapse } from "antd";
import { ReactNode } from "react";
import MediaAsset from "./MediaAsset";
import { useReactive } from "ahooks";

interface ReplaceMediaProps {
  alternativeMedia?: MediaAssetType[];
  onSelectMedia: (asset: MediaAssetType) => void;
  externalLibrary?: ReactNode;
  externalLibraryLabel?: string;
}

const ReplaceMedia = ({
  alternativeMedia,
  onSelectMedia,
  externalLibrary,
  externalLibraryLabel = "External library",
}: ReplaceMediaProps) => {
  const state = useReactive({
    activeKey: undefined as string | string[] | undefined,
  });

  const hasAlternativeMedia = Boolean(alternativeMedia && alternativeMedia.length > 0);
  const hasExternalLibrary = Boolean(externalLibrary);

  if (!hasAlternativeMedia && !hasExternalLibrary) {
    return null;
  }

  const handleChangeCollapse = (key: string | string[]) => {
    state.activeKey = key;
  };

  const items = [
    hasAlternativeMedia
      ? {
          key: "1",
          label: "Other media from article",
          children: (
            <div className="gap-4 grid grid-cols-2">
              {alternativeMedia?.map((i, index) => (
                <div key={index} className="gap-2 grid grid-cols-1">
                  <MediaAsset editable={false} value={i} />
                  <Button
                    onClick={() => {
                      onSelectMedia(i);
                      state.activeKey = undefined;
                    }}
                    type="primary"
                    block
                  >
                    Select
                  </Button>
                </div>
              ))}
            </div>
          ),
        }
      : null,
    {
      key: "2",
      label: externalLibraryLabel,
      children: externalLibrary || (
        <Alert
          type="info"
          title="External media library integrations are disabled in minimal mode."
        />
      ),
    },
  ].filter((item) => item !== null) as Array<{
    key: string;
    label: string;
    children: ReactNode;
  }>;

  return (
    <Collapse
      activeKey={state.activeKey}
      onChange={handleChangeCollapse}
      items={items}
    />
  );
};

export default ReplaceMedia;
