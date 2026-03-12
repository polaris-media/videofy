import importlib.util
import json
import sys
from pathlib import Path


def load_fetcher_module():
    module_path = (
        Path(__file__).resolve().parents[1] / "fetchers" / "polaris-capi" / "fetcher.py"
    )
    spec = importlib.util.spec_from_file_location("polaris_capi_fetcher", module_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_resolve_article_ref_from_supported_urls():
    fetcher = load_fetcher_module()
    fetcher._cached_newsroom_index = None
    fetcher._fetch_newsroom_directory = lambda timeout: [
        ("fvn", "fvn.no"),
        ("adresseavisen", "adressa.no"),
        ("smpno", "smp.no"),
        ("agderposten", "agderposten.no"),
    ]

    fvn = fetcher.resolve_article_ref(
        "https://www.fvn.no/nyheter/i/8JbgWd/demo-artikkel",
        None,
        timeout=5,
    )
    assert fvn.article_id == "8JbgWd"
    assert fvn.newsroom == "fvn"

    adressa = fetcher.resolve_article_ref(
        "https://www.adressa.no/nyheter/i/mB0J4g/demo-artikkel",
        None,
        timeout=5,
    )
    assert adressa.article_id == "mB0J4g"
    assert adressa.newsroom == "adresseavisen"

    smp = fetcher.resolve_article_ref(
        "https://www.smp.no/sport/a/JQ2dA4/demo-artikkel",
        None,
        timeout=5,
    )
    assert smp.article_id == "JQ2dA4"
    assert smp.newsroom == "smpno"

    agderposten = fetcher.resolve_article_ref(
        "https://www.agderposten.no/nyheter/i/AbCd12/demo-artikkel",
        None,
        timeout=5,
    )
    assert agderposten.article_id == "AbCd12"
    assert agderposten.newsroom == "agderposten"

    by_id = fetcher.resolve_article_ref("abc123", "agderposten", timeout=5)
    assert by_id.article_id == "abc123"
    assert by_id.newsroom == "agderposten"


def test_parse_article_payload_extracts_text_and_media():
    fetcher = load_fetcher_module()

    article_ref = fetcher.ArticleRef(
        article_id="abc123",
        newsroom="fvn",
        source_url="https://www.fvn.no/nyheter/i/abc123/demo-artikkel",
    )
    payload = {
        "id": "abc123",
        "title": {"value": "Storm treffer kysten"},
        "published": "2026-03-11T09:00:00Z",
        "authors": [{"name": "Ola Nordmann"}],
        "author": {
            "name": "Ola Nordmann",
            "imageAsset": {
                "id": "author-headshot",
                "size": {"width": 400, "height": 400},
            },
        },
        "lead": "Kystkommunene forbereder seg.",
        "content": [
            {"type": "paragraph", "text": "Første avsnitt fra artikkelen."},
            {"type": "paragraph", "text": "Andre avsnitt fra artikkelen."},
            {
                "type": "image",
                "imageAsset": {
                    "id": "photo-asset-id",
                    "size": {"width": 6000, "height": 4000},
                    "alt": "Redningsmannskap ved kysten",
                },
                "byline": "Kari Fotograf",
            },
            {
                "type": "video",
                "videoAsset": {
                    "streamUrls": {
                        "mp4": "https://cdn.example.com/video/clip.mp4",
                    }
                },
                "credit": "NTB TV",
            },
        ],
    }

    parsed = fetcher.parse_article_payload(payload, article_ref)

    assert parsed.title == "Storm treffer kysten"
    assert parsed.byline == "Av Ola Nordmann"
    assert parsed.pubdate == "2026-03-11T09:00:00Z"
    assert "Kystkommunene forbereder seg." in parsed.text
    assert "Første avsnitt fra artikkelen." in parsed.text
    assert "Andre avsnitt fra artikkelen." in parsed.text
    assert len(parsed.images) == 1
    assert parsed.images[0].url.startswith("https://vcdn.polarismedia.no/photo-asset-id")
    assert "w=1600" in parsed.images[0].url
    assert parsed.images[0].byline == "Kari Fotograf"
    assert parsed.images[0].alt == "Redningsmannskap ved kysten"
    assert parsed.images[0].srcset is not None
    assert len(parsed.videos) == 1
    assert parsed.videos[0].url == "https://cdn.example.com/video/clip.mp4"
    assert parsed.videos[0].byline == "NTB TV"


def test_should_send_auth_header_only_for_plan3_hosts():
    fetcher = load_fetcher_module()

    assert fetcher._should_send_auth_header(
        "https://content.api.plan3.se/entities/v1/fvn/article/abc123?format=v5"
    )
    assert fetcher._should_send_auth_header(
        "https://assets.plan3.se/downloads/image.jpg"
    )
    assert not fetcher._should_send_auth_header(
        "https://vcdn.polarismedia.no/photo-asset-id?fit=clip&w=1600"
    )
    assert not fetcher._should_send_auth_header(
        "https://dd-polaris.akamaized.net/fvn/vod/demo.mp4"
    )


def test_import_polaris_article_writes_project_files(tmp_path, monkeypatch):
    fetcher = load_fetcher_module()

    source_payload = {
        "id": "abc123",
        "title": {"value": "Storm treffer kysten"},
        "published": "2026-03-11T09:00:00Z",
        "authors": [{"name": "Ola Nordmann"}],
        "lead": "Kystkommunene forbereder seg.",
        "content": [
            {"type": "paragraph", "text": "Første avsnitt fra artikkelen."},
            {
                "type": "image",
                "url": "https://cdn.example.com/images/main",
                "byline": "Kari Fotograf",
            },
            {
                "type": "video",
                "streamUrl": "https://cdn.example.com/video/clip.mp4",
                "credit": "NTB TV",
            },
        ],
    }

    monkeypatch.setenv("CAPI_USERNAME", "user")
    monkeypatch.setenv("CAPI_PASSWORD", "password")
    monkeypatch.setattr(fetcher, "fetch_article_json", lambda article_ref, timeout: source_payload)

    def fake_download_media(candidate, *, project_dir, index, timeout, auth_header):
        folder = "videos" if candidate.kind == "video" else "images"
        kind = "video" if candidate.kind == "video" else "image"
        ext = ".mp4" if kind == "video" else ".jpg"
        target = project_dir / "input" / folder / f"{kind}-{index:03}{ext}"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"data")
        return fetcher.MediaResult(rel_path=f"{folder}/{target.name}", byline=candidate.byline)

    monkeypatch.setattr(fetcher, "download_media", fake_download_media)

    project_dir = fetcher.import_polaris_article(
        article_ref_raw="https://www.fvn.no/nyheter/i/abc123/demo-artikkel",
        newsroom=None,
        project_id=None,
        projects_root=tmp_path / "projects",
        timeout=5,
        force=False,
    )

    article_path = project_dir / "input" / "article.json"
    generation_path = project_dir / "generation.json"
    source_path = project_dir / "working" / "polaris_capi_source.json"

    assert article_path.exists()
    assert generation_path.exists()
    assert source_path.exists()

    article = json.loads(article_path.read_text(encoding="utf-8"))
    assert article["title"] == "Storm treffer kysten"
    assert article["byline"] == "Av Ola Nordmann"
    assert article["images"] == [
        {"path": "images/image-001.jpg", "byline": "Kari Fotograf"}
    ]
    assert article["videos"] == [
        {
            "path": "videos/video-001.mp4",
            "byline": "NTB TV",
            "start_from": None,
            "end_at": None,
        }
    ]

    generation = json.loads(generation_path.read_text(encoding="utf-8"))
    assert generation["projectId"] == "polaris-fvn-abc123"
    assert generation["brandId"] == "default"
