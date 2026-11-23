#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${1:-https://md2pdf-by.shivam007.dev/api/export}"
DELAY="${DELAY:-6.5}" # Stay under SlowAPI's 10 req/min limit (set DELAY=0 for local)
FIXTURE_DIR="tests/fixtures"
TMP_JSON=$(mktemp /tmp/md2pdf_payload.XXXXXX.json)
trap 'rm -f "$TMP_JSON"' EXIT

echo "Benchmarking endpoint: $ENDPOINT (pacing: ${DELAY}s between requests)"
echo ""
echo "| Fixture | Size | HTTP | TTFB | Total |"
echo "| :--- | ---: | :---: | ---: | ---: |"

count=0
total_files=$(ls -1 "$FIXTURE_DIR"/*.md | wc -l | tr -d ' ')

for file in "$FIXTURE_DIR"/*.md; do
  count=$((count + 1))
  name=$(basename "$file")
  bytes=$(wc -c < "$file" | tr -d ' ')

  # Safely serialize markdown file to JSON on disk
  python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as f:
    data = {"markdown": f.read(), "css": ""}
with open(sys.argv[2], "w", encoding="utf-8") as out:
    json.dump(data, out)
' "$file" "$TMP_JSON"

  metrics=$(curl -s -o /dev/null \
    -w "%{http_code}|%{time_starttransfer}|%{time_total}" \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    --data-binary "@$TMP_JSON")

  IFS='|' read -r status ttfb total <<< "$metrics"
  printf "| \`%s\` | %s B | \`%s\` | %.3fs | %.3fs |\n" "$name" "$bytes" "$status" "$ttfb" "$total"

  if [ "$count" -lt "$total_files" ] && [ "$DELAY" != "0" ]; then
    sleep "$DELAY"
  fi
done
