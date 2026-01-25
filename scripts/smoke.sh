#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${BASE:-}" ]]; then
  echo "BASE is required, e.g. BASE=http://localhost:8787"
  exit 1
fi

doc_response=$(curl -sS -X POST "$BASE/api/doc?userId=gaurang" \
  -H "content-type: application/json" \
  -d '{"title":"truth","content":"Cloudflare builds a better internet."}')

message_response=$(curl -sS -X POST "$BASE/api/message?userId=gaurang" \
  -H "content-type: application/json" \
  -d '{"text":"What did I upload? Answer in one sentence."}')

memories_response=$(curl -sS "$BASE/api/memories?userId=gaurang")

echo "$doc_response"
echo "$message_response"
echo "$memories_response"

used_docs=$(MSG="$message_response" python - <<'PY'
import json, os, sys
resp = json.loads(os.environ["MSG"]) if os.environ.get("MSG") else {}
used = resp.get("usedDocs") or []
print(len(used))
PY
)

answer=$(MSG="$message_response" python - <<'PY'
import json, os
resp = json.loads(os.environ["MSG"]) if os.environ.get("MSG") else {}
print(resp.get("answer", ""))
PY
)

if [[ "$used_docs" -eq 0 ]] || [[ -z "$answer" ]]; then
  echo "smoke failed: empty usedDocs or answer"
  exit 1
fi

docs_len=$(MEM="$memories_response" python - <<'PY'
import json, os
resp = json.loads(os.environ["MEM"]) if os.environ.get("MEM") else {}
docs = resp.get("memories", {}).get("docs") if isinstance(resp.get("memories"), dict) else resp.get("docs")
print(len(docs) if docs else 0)
PY
)

if [[ "$docs_len" -lt 1 ]]; then
  echo "smoke failed: docs list empty"
  exit 1
fi

if [[ "$answer" != *"Cloudflare builds a better internet"* ]]; then
  echo "smoke failed: answer does not reference uploaded content"
  exit 1
fi
