#!/usr/bin/env bash
# Helper de build de la sesión TSK-010 — envuelve el comando REAL del repo (npm).
set -euo pipefail
export PATH="$HOME/.local/node22/bin:$PATH"
cd "$(dirname "$0")/../.."

cmd="${1:-test}"
shift || true
case "$cmd" in
  install) npm install "$@" ;;
  test)    npm test "$@" ;;
  *)       npm "$cmd" "$@" ;;
esac
