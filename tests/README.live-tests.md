Live CMS tests are opt-in because they require a running CMS instance, working Polaris credentials,
and they spend OpenAI tokens.

Run the vertical download regression test with:

```bash
RUN_LIVE_CMS_TESTS=1 \
LIVE_CMS_BASE_URL=http://127.0.0.1:3000 \
LIVE_POLARIS_NEWSROOM=fvn \
pytest -q tests/test_live_cms_vertical_download.py
```

Optional:

- `LIVE_POLARIS_ARTICLE_REFS=id1,id2`
  Uses explicit article refs instead of fetching the latest two articles for the newsroom.
- `LIVE_RENDER_TIMEOUT_SECONDS=600`
  Overrides the render job polling timeout.
