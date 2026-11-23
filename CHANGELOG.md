# Changelog

## [v2.0.0] — v2 Re-architecture

**Client-side rendering pipeline**

- Markdown, math, and diagrams now render entirely in the browser. `markdown-it` handles Markdown parsing; `KaTeX` renders inline and block LaTeX; `Mermaid.js` renders diagrams; `DOMPurify` sanitizes all output before it enters the DOM.
- PDF export uses the Chrome Print API (`window.print()`) — no server round-trip, no S3 upload, no WeasyPrint.

**Editor improvements**

- CodeMirror 6 editor with a custom Markdown syntax linter.
- `harper.js` WASM spellcheck runs in a Web Worker, entirely in-browser with no data leaving the client.

**Rust (Axum) + Redis share service**

- New `POST /shared` endpoint accepts zstd-compressed payloads and stores them in Redis with a 7-day TTL.
- Share IDs are 12-character CSPRNG-generated strings.
- `GET /shared/:id` returns the compressed payload; the browser decodes and renders it.
- Per-IP rate limiting via Redis. Server-side title/CSS sanitization before storage.

**Zero external render APIs**

- Removed all runtime dependencies on `mermaid.ink`, `kroki.io`, `latex.codecogs.com`, Google Fonts CDN, jsDelivr CDN, and AWS S3.
- Legacy Kroki diagram languages (plantuml, d2, graphviz, etc.) render as fenced source blocks rather than calling external servers.

**Test coverage**

- 94/94 frontend tests (Vitest).
- 25/25 backend integration tests (`cargo test`), run live against Redis in CI.

---

## [v1.4.0] — The Formatting & Reliability Update

- **Dynamic Landscape Tables:** Handled WeasyPrint's table-overflow bug by building a custom Python HTML parser that scans rendered HTML and intelligently wraps massively wide tables (>5 columns) in an `@page landscape` print directive, preventing data clipping.
- **Universal Math Delimiters:** Expanded the LaTeX parsing engine to recognize and correctly process standard LaTeX brackets (`\(` and `\[`) alongside the traditional Markdown `$` indicators across both the live preview and backend PDF engine.
- **Emoji & Extended Unicode Support:** Injected `Noto Color Emoji` and `Noto Sans` into the global CSS fallback stack to permanently banish "tofu" empty-rectangle characters from rendered PDFs.
- **SSRF Allowlist Expansion:** Upgraded the security manager to safely permit embedded external images from common trusted CDNs (like OpenAI, GitHub, AWS S3, and Imgur) without triggering false-positive alerts in the nightly health check.
- **Mermaid.ink Migration:** Re-routed all Mermaid diagram traffic away from `kroki.io` (due to heavy timeout issues) to the official `mermaid.ink` API for instant rendering, while retaining Kroki for PlantUML and D2.

## [v1.3.0] — The Bulletproof Server Update

- **Math Edge-Case Protection:** Implemented a pre-processor masking strategy for code blocks. Shell scripts and code variables (like `$HADOOP_HOME`) are now perfectly shielded from the LaTeX regex parser, entirely eliminating the 40-second timeout bug.
- **Comprehensive Health Check System:** Built a zero-maintenance Python cron script that pings the live server daily. On Sundays at midnight, it goes a step further: it dynamically generates a rich Markdown payload (with LaTeX and Mermaid diagrams), hits the E2E `/export` API, downloads the resulting PDF, and emails it to the admin. This conclusively proves the entire pipeline (Parser -> CodeCogs -> Kroki -> WeasyPrint -> S3 -> Email) is 100% operational.
- **Proxy Rate-Limit Fix:** Configured Uvicorn to parse `X-Forwarded-For` headers (`--proxy-headers`), fixing a bug where SlowAPI globally rate-limited the entire application due to Cloudflare/Caddy IP masking.

## [v1.2.0] — The "Never Lose Work" Update

- **IndexedDB Auto-Save:** Implemented seamless, silent background auto-saving using `localforage`. Your drafts (Markdown, CSS, and images) survive tab closures, refreshes, and browser crashes.
- **"Google Docs" Style Indicators:** Added live "Saving..." and "Saved locally" indicators to the top header for complete peace of mind.
- **Responsive A4 Editor:** Configured CodeMirror to automatically wrap lines and intelligently cap the width (`max-w-4xl`) on large monitors to mimic an A4 PDF document, while remaining fluid on mobile devices.
- **Clear Document Workflow:** Added a handy "Clear" button to quickly purge local storage and start fresh.

## [v1.1.0] — The Math Polish Update

- **SVG Math Architecture:** Replaced legacy high-DPI PNG rendering for math formulas with scalable SVGs. This fully resolved all pixel layout sizing bugs and CSS scaling issues natively within WeasyPrint.
- **Robust Regex Parsing:** Implemented sequential UUID placeholders in `app/convert.py` to fix regex overlap bugs, fully supporting nested block and inline math without HTML corruption.
- **Async Fetching:** Built out `asyncio.gather` logic for LaTeX formula fetching, dropping PDF generation time.
- **Automated Deployment Sync:** Fully synced GitHub Actions CI/CD to AWS EC2 so every GitHub push instantly mirrors to production.
