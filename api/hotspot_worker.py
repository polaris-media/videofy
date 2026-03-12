from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

MODEL_ID = os.getenv("HOTSPOT_MODEL_ID", "sch-ai/detr-hotspot")


def _read_input(path: Path) -> list[dict[str, str]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    assets = payload.get("assets", [])
    if not isinstance(assets, list):
        return []
    output: list[dict[str, str]] = []
    for item in assets:
        if not isinstance(item, dict):
            continue
        asset_id = item.get("asset_id")
        image_path = item.get("path")
        if isinstance(asset_id, str) and isinstance(image_path, str):
            output.append({"asset_id": asset_id, "path": image_path})
    return output


def _write_output(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def _normalize_box(
    top_box: Any,
    original_width: int,
    original_height: int,
) -> dict[str, float] | None:
    try:
        x1 = float(top_box[0].item())
        y1 = float(top_box[1].item())
        x2 = float(top_box[2].item())
        y2 = float(top_box[3].item())
        width = max(1.0, x2 - x1)
        height = max(1.0, y2 - y1)
        return {
            "x": round(x1, 3),
            "y": round(y1, 3),
            "width": round(width, 3),
            "height": round(height, 3),
            "x_norm": round(x1 / original_width, 4),
            "y_norm": round(y1 / original_height, 4),
            "width_norm": round(width / original_width, 4),
            "height_norm": round(height / original_height, 4),
        }
    except Exception:
        return None


def _load_hotspot_model_components(model_id: str, token: str | None) -> tuple[Any, Any]:
    import json as jsonlib

    from huggingface_hub import hf_hub_download
    from transformers import (
        AutoImageProcessor,
        AutoModelForObjectDetection,
        DetrConfig,
    )

    image_processor = AutoImageProcessor.from_pretrained(model_id, token=token)

    try:
        model = AutoModelForObjectDetection.from_pretrained(model_id, token=token)
    except AttributeError as exc:
        # transformers>=5 can fail on some DETR configs where backbone_kwargs is null.
        if "'NoneType' object has no attribute 'get'" not in str(exc):
            raise
        config_path = hf_hub_download(
            repo_id=model_id,
            filename="config.json",
            token=token,
        )
        config_payload = jsonlib.loads(Path(config_path).read_text(encoding="utf-8"))
        if config_payload.get("backbone_kwargs") is None:
            config_payload["backbone_kwargs"] = {}
        config = DetrConfig.from_dict(config_payload)
        model = AutoModelForObjectDetection.from_pretrained(
            model_id,
            token=token,
            config=config,
        )

    model.eval()
    return image_processor, model


def run_hotspot_inference(assets: list[dict[str, str]]) -> dict[str, Any]:
    try:
        import albumentations
        import numpy as np
        import torch
        from PIL import Image
    except Exception as exc:
        return {
            "provider": "noop",
            "status": "missing-deps",
            "error": str(exc),
            "results": {},
        }

    token = os.getenv("HUGGING_FACE_HUB_TOKEN")
    try:
        image_processor, model = _load_hotspot_model_components(MODEL_ID, token)
    except Exception as exc:
        return {
            "provider": "noop",
            "status": "model-load-failed",
            "error": str(exc),
            "results": {},
        }

    transform = albumentations.Compose([albumentations.Resize(480, 480)])
    results: dict[str, Any] = {}

    for item in assets:
        asset_id = item["asset_id"]
        image_path = Path(item["path"])
        if not image_path.exists():
            continue
        try:
            image = Image.open(image_path).convert("RGB")
            original_width, original_height = image.size
            np_image = np.array(image)
            transformed = transform(image=np_image)["image"]
            tensor = torch.stack([torch.tensor(transformed).permute(2, 0, 1)])
            inputs = image_processor(images=tensor, return_tensors="pt")
            with torch.no_grad():
                outputs = model(**inputs)
                target_sizes = torch.tensor([[original_height, original_width]])
                processed = image_processor.post_process_object_detection(
                    outputs,
                    threshold=0.01,
                    target_sizes=target_sizes,
                )
            if not processed:
                continue
            first = processed[0]
            scores = first.get("scores")
            boxes = first.get("boxes")
            if scores is None or boxes is None or len(scores) == 0:
                continue
            _, top_idx = scores.max(0)
            hotspot = _normalize_box(boxes[top_idx], original_width, original_height)
            if hotspot is not None:
                results[asset_id] = hotspot
        except Exception:
            continue

    return {"provider": "hf-detr-hotspot", "status": "ok", "results": results}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Predict image hotspots from local paths"
    )
    parser.add_argument("--input", required=True, help="Path to worker input JSON")
    parser.add_argument("--output", required=True, help="Path to worker output JSON")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    assets = _read_input(input_path)
    if not assets:
        _write_output(
            output_path,
            {"provider": "noop", "status": "no-assets", "results": {}},
        )
        return 0

    payload = run_hotspot_inference(assets)
    _write_output(output_path, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
