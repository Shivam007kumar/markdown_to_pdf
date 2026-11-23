# MD2PDF v1 Production Baselines (Pre-v2 Reference)

- **Date Recorded:** 2026-11-23
- **Instance:** AWS EC2 `t4g.small` (`aarch64` Graviton, `1837 MB` usable RAM, `10.58 GB` `gp3`, `0 MB` swap)
- **Runtime:** Ubuntu 24.04.5 LTS, Uvicorn (`--workers 3`), Caddy, Cloudflare Tunnel
- **Branch Baseline:** `main` (`v1.4.0`) prior to `v2-client-render`

---

## 1. Memory Footprint (`free -m`)

| State | Total (MB) | Used (MB) | Free (MB) | Buff/Cache (MB) | Available (MB) | Swap Used (MB) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Idle** (3 Uvicorn workers + Caddy + `cloudflared`) | 1837 | 813 | 196 | 1011 | 1023 | 0 |
| **Under Load** (Active WeasyPrint 7-col × 60-row table render) | 1837 | 815 | 193 | 1012 | 1021 | 0 |

---

## 2. Live Export Latency (`/api/export`)

Measured locally against Caddy (`http://127.0.0.1/api/export`, bypassing Cloudflare edge latency; includes S3 upload + presigned URL generation):

| Test Case | Payload Profile | HTTP Status | TTFB (`time_starttransfer`) | Total Time (`time_total`) |
| :--- | :--- | :---: | :---: | :---: |
| **Simple Doc** | Heading + basic Markdown text, no diagrams/math | `200` | `0.418s` | `0.418s` |
| **Math + Mermaid Doc** | Inline/block LaTeX + 1 Mermaid flowchart (`mermaid.ink`) | `200` | `3.843s` | `3.843s` |
| **Large / Wide-Table Doc** | 7-column, 60-row GFM table (`@page landscape` HTML pass) | `200` | `1.059s` | `1.059s` |

> **Key Bottlenecks:**
> - Adding 1 Mermaid diagram + KaTeX math increases server-side export latency by **9.2×** (`0.418s` → `3.843s`) due to external network fetches during PDF assembly.
> - Rendering a 7-column, 60-row landscape table increases export latency by **2.5×** (`0.418s` → `1.059s`) due to server-side HTML table parsing and WeasyPrint layout passes.

---

## 3. External Runtime Dependencies (`5` Active Services)

Audit of `/home/ubuntu/markdown_to_pdf/backend/app/` for runtime network calls outside the EC2 instance:

| # | Service / Host | Code Location | Role in v1 Pipeline |
| :-: | :--- | :--- | :--- |
| 1 | **`mermaid.ink`** | `app/convert.py:45`, `app/pdf.py:26` | Fetches rendered PNGs for `mermaid` code blocks |
| 2 | **`kroki.io`** | `app/convert.py:48`, `app/pdf.py:26` | Fetches rendered PNGs for PlantUML, D2, Graphviz, Excalidraw, Structurizr |
| 3 | **`fonts.googleapis.com`** (`fonts.gstatic.com`) | `app/styles.py:6`, `app/pdf.py:27` | `@import` for `Barlow` and `Fira Code` during WeasyPrint CSS resolution |
| 4 | **`cdn.jsdelivr.net`** | `app/styles.py:7` | `@import` for `katex@0.16.8/dist/katex.min.css` during WeasyPrint CSS resolution |
| 5 | **AWS S3 (`boto3`)** | `app/s3.py:24-69`, `app/main.py:81` | `put_object` upload of generated PDF + `generate_presigned_url` (`ap-south-1`) |

*(Note: `latex.codecogs.com` remains in `app/pdf.py:26`'s SSRF allowlist as a legacy entry from v1.1.0, but is no longer invoked by `app/convert.py`.)*

---

## v2 Migration Targets (`v2-client-render`)

1. **Eliminate External Render Hops:** Move Markdown, KaTeX math, Mermaid/diagram rendering, and PDF generation client-side (or self-contained assets) to cut the `3.843s` network-bound render penalty and remove `mermaid.ink`, `kroki.io`, `fonts.googleapis.com`, and `cdn.jsdelivr.net` as runtime failure points.
2. **Eliminate S3 Round-Trip & Server Compute:** Generate and download PDFs directly in the browser without buffering documents in `t4g.small` RAM (`813–815 MB` baseline) or round-tripping through AWS S3.

Benchmarking endpoint: https://md2pdf-by.shivam007.dev/api/export (pacing: 6.5s between requests)

| Fixture | Size | HTTP | TTFB | Total |
| :--- | ---: | :---: | ---: | ---: |
| `01-chatgpt-math-delimiters.md` | 518 B | `200` | 0.678s | 0.678s |
| `02-code-env-vars-and-currency.md` | 667 B | `200` | 0.616s | 0.616s |
| `03-nested-formatting-with-math.md` | 764 B | `200` | 0.865s | 0.865s |
| `04-broken-latex-graceful-fallback.md` | 451 B | `200` | 0.617s | 0.617s |
| `05-complex-mermaid-valid-and-broken.md` | 1098 B | `200` | 3.027s | 3.027s |
| `06-wide-table-overflow.md` | 1357 B | `200` | 1.053s | 1.053s |
| `07-emoji-unicode-and-digits.md` | 1336 B | `200` | 0.889s | 0.889s |
| `08-non-mermaid-diagrams-kroki.md` | 448 B | `200` | 1.284s | 1.284s |
| `09-gfm-kitchen-sink-and-links.md` | 627 B | `200` | 0.866s | 0.867s |
| `10-custom-css-and-page-breaks.md` | 817 B | `200` | 0.562s | 0.563s |
| `11-large-chatgpt-paste-70kb.md` | 67707 B | `200` | 111.528s | 111.531s |
