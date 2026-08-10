# DengTa bundled fonts

The App bundles locally subsetted WOFF2 files so Android can render the selected
type system without a font CDN:

- Noto Sans SC: chat copy, settings and controls.
- Noto Serif SC: display headings and companion names.
- LXGW WenKai Lite: short emotional notes and navigation labels.
- Roboto Mono: English data, times and technical labels.
- Chill Round F: rounded Chinese display text used by the cream chat skin.

All five families are distributed under SIL Open Font License 1.1. The complete
license text for each upstream family is stored beside the font files. The
subsets include DengTa's current interface characters; unsupported characters
fall back to the platform CJK fonts declared in `src/native-feel.css`.
