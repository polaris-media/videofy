# Default Brand Config

This documents [`default.json`](./default.json).

The brand file must stay valid JSON. Regular JSON comments are not supported by the CMS or backend loaders.

## Sections

- `openai`: Model choices for manuscript generation and media placement.
- `options`: Small brand-level behavior overrides such as segment pause timing.
- `exportDefaults`: Default toggle values shown in the download/export UI.
- `people`: Voice and TTS defaults for generated narration.
- `prompts`: Brand-specific prompt instructions used during manuscript and placement generation.
- `player`: Visual identity, logo, transitions, colors, and optional background music.

## Player Fields

- `logo`: Logo asset shown in the rendered video.
- `logoStyle`: Inline CSS used to position the logo overlay.
- `defaultCameraMovements`: Fallback camera motions for still images.
- `colors`: Theme colors for text cards, progress bar, map marker, and photo credits.
- `backgroundMusic`: Optional music track. Can be external or served locally.
- `intro`: Optional intro cut with portrait and landscape asset paths, duration, and offset.
- `wipe`: Optional transition cut between story segments.
- `outro`: Optional outro cut shown at the end of the video.

## Asset Notes

- Externally hosted assets are still supported.
- Relative or root-relative assets are resolved from the configured asset base URL.
