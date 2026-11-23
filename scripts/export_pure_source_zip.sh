#!/usr/bin/env bash
# Portable, non-destructive exporter. No fixed home directory or staging rm -rf.
# Usage: ./scripts/export_pure_source_zip.sh --output /path/review.zip --round R98
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
exec python3 "$SCRIPT_DIR/export_pure_source_zip.py" "$@"
