# GFM Kitchen Sink, Task Lists & Escaped Characters

- [x] Migrate math rendering to local KaTeX
- [x] Eliminate S3 round-trip latency
- [ ] Verify print page breaks (`break-inside: avoid`)

Strikethrough: ~~WeasyPrint OOM on 2GB RAM~~ → Client-side print pipeline.

Autolinks & special characters:
- URL with underscores and query params: https://example.com/docs/v2_migration?mode=client_render&retry=1#section_2
- Escaped markdown characters: \*not italic\*, \`not code\`, \$not_math\$, \|pipe\|
- Footnote reference[^1] and inline HTML `<kbd>Cmd</kbd> + <kbd>P</kbd>`.

[^1]: Footnote rendering check at document bottom.
