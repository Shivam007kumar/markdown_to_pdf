# Wide Table Overflow & Long URL Wrapping (8 Columns)

| Service ID | Environment | Endpoint URL | Upstream Dependency | Auth Mechanism | Avg Latency | Memory Overhead | Fallback Strategy |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `svc-md2pdf-core-01` | Production (`ap-south-1`) | `https://md2pdf-by.shivam007.dev/api/v2/export/render-pipeline` | `https://kroki.io/plantuml/svg/eNpLzkksLnbJTEwvSszlAgAoMgW0` | Cloudflare Zero Trust + Signed JWT Bearer | `418ms` | `813MB` | Client-side WASM/JS fallback |
| `svc-math-katex-02` | Production (`ap-south-1`) | `https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css` | Local bundled WOFF2 font subset | Subresource Integrity (`sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+`) | `12ms` | `4.2MB` | Inline base64 font data URI |
| `svc-diagram-mermaid-03` | Staging (`ap-south-1`) | `https://mermaid.ink/svg/pako:eNpVjsEKwjAQRH9lmXMPvkBPoR70JLW` | Local `mermaid.esm.min.mjs` bundle | None (in-memory DOM SVG serialization) | `3843ms` | `42MB` | Raw fenced code block fallback |
| `svc-storage-presign-04` | Deprecated in v2 | `https://s3.ap-south-1.amazonaws.com/md2pdf-exports-prod/2026/11/23/report-final.pdf` | AWS IAM Role + `boto3` S3v4 Signature | Presigned Query String (`X-Amz-Expires=300`) | `190ms` | `18MB` | `window.print()` / `Blob` download |
