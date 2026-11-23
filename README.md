<div align="center">

<img src="docs_white.png" alt="MD2PDF Logo" width="100" />

# MD2PDF

**Convert Markdown into beautiful, print-ready PDFs — instantly.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-md2pdf--by.shivam007.dev-black?style=for-the-badge&logo=amazonaws)](https://md2pdf-by.shivam007.dev)
[![GitHub Stars](https://img.shields.io/github/stars/Shivam007kumar/markdown_to_pdf?style=for-the-badge&logo=github&color=black)](https://github.com/Shivam007kumar/markdown_to_pdf/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=for-the-badge)](LICENSE)

</div>

---

## What is MD2PDF?

MD2PDF is a browser-based tool that converts Markdown to PDF without a server round-trip. You write Markdown, the browser renders it (math, diagrams, syntax highlighting, custom CSS), and Chrome's Print API generates the PDF locally. An optional Rust/Redis backend lets you share documents via a short link.

No accounts. No installs.

> **Try it live → [md2pdf-by.shivam007.dev](https://md2pdf-by.shivam007.dev)**

---

## Architecture (v1 → v2)

v1 sent every export to a Python/WeasyPrint server that called out to `mermaid.ink`, `kroki.io`, and AWS S3. A single 67 KB document took over 111 seconds. v2 moves rendering entirely into the browser.

```
Browser
  Markdown Input
       │
       ▼
  [markdown-it + KaTeX + Mermaid + DOMPurify]  ← CodeMirror 6 editor
  [harper.js WASM spellcheck worker]              (lint / spell in-browser)
       │
       ▼
  Chrome Print API  →  PDF download (no server round-trip)

Sharing (optional)
  POST /shared  →  Rust (Axum) + Redis
                    12-char CSPRNG ID, zstd, 7-day TTL
                    per-IP rate limit
                    GET /shared/:id  →  Browser decodes + renders
```

---

## v1 → v2 Benchmarks

| Metric | v1 (server-side) | v2 (client-side) |
|---|---|---|
| 67 KB ChatGPT paste — render time | 111.53 s | 152.5 ms |
| External runtime dependencies | 5 (mermaid.ink, kroki.io, Google Fonts, jsDelivr, AWS S3) | 0 |
| Backend idle RAM (EC2 t4g.small) | 813 MB (Python + WeasyPrint × 3 workers) | ~4.5 MB static Rust binary + 256 MB Redis cap |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, CodeMirror 6 |
| Markdown render | markdown-it, KaTeX, Mermaid.js, DOMPurify |
| Spellcheck | harper.js (WASM worker, runs fully in-browser) |
| PDF export | Chrome Print API (`window.print()`) |
| Share backend | Rust (Axum 0.8), Redis 7 |
| Share storage | Redis (zstd-compressed, volatile-ttl, 256 MB cap) |
| Deployment | AWS EC2 (Graviton), Caddy, Cloudflare Tunnels, GitHub Actions |

---

## Security & Privacy

- Drafts are stored in local IndexedDB and never leave the browser unless you explicitly use the Share feature.
- `/shared/:id` uses 12-char CSPRNG IDs, zstd compression, 7-day TTL, server-side title/CSS sanitization, client-side DOMPurify, and per-IP Redis rate limiting.

---

## Running Locally & Testing

```bash
# Start Redis
docker compose up -d redis

# Backend
cd backend && cargo run         # starts on :8000
cd backend && cargo test        # 25/25 tests

# Frontend
cd frontend && npm run dev      # starts on :5173
cd frontend && npm test         # 94/94 checks
```

For production EC2 setup, see [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md).

---

## Known Limitations

- Chrome (desktop & Android) is the primary PDF print target. iOS Safari and in-app WebViews (WhatsApp, Telegram) have degraded `window.print()` behavior; the app shows a WebView warning banner in those environments.
- Legacy Kroki diagram languages (plantuml, d2, graphviz, etc.) render as offline source blocks rather than calling external servers.
- Shared links expire after 7 days, or earlier if Redis hits its 256 MB volatile-ttl eviction limit.

---

## Future Scope (v3)

- Chrome extension for 1-click capture
- Multi-doc workspace
- CRDT collaboration via Yjs/yrs
- Print templates (academic, resume, corporate)

---

## Changelog

Full changelog in [CHANGELOG.md](CHANGELOG.md).

---

<div align="center">

If MD2PDF saves you time, a ⭐ on GitHub goes a long way.

**[Star the repo →](https://github.com/Shivam007kumar/markdown_to_pdf)**

<sub>GrowthX × AWS Off Campus Builder Code: `3HNVHB`</sub>

</div>
