# Fetcher Plugins

Each fetcher plugin lives in `fetchers/<id>/` and contains:

- `fetcher.py` (the executable importer script)
- `fetcher.json` (metadata for CMS dynamic form + argument mapping)

## `fetcher.json` schema

```json
{
  "id": "web",
  "title": "Web URL",
  "description": "Import from public URL",
  "script": "fetcher.py",
  "fields": [
    { "name": "url", "label": "Article URL", "required": true },
    { "name": "project_id", "label": "Project ID (optional)", "required": false }
  ],
  "args": ["{url}"],
  "optionalFlags": [
    { "field": "project_id", "flag": "--project-id" }
  ]
}
```

- `fields`: rendered as text inputs in CMS.
- `args`: positional argv entries, placeholders resolved from `fields` by `name`.
- `optionalFlags`: include `flag + value` only when that field has a value.

## Boilerplate

Start from `fetchers/_template/` when creating a new fetcher.
