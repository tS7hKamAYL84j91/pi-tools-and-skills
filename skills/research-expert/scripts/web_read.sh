#!/usr/bin/env bash
# Read a URL and return clean text content using Jina Reader.
# Usage: web_read.sh "https://example.com/article"
# Free API, no key required.

set -euo pipefail

URL="${1:?Usage: web_read.sh \"https://example.com/article\"}"

# Jina Reader converts any URL to clean markdown text
curl -s "https://r.jina.ai/${URL}" \
  -H "Accept: text/plain" \
  -H "X-Return-Format: text"
