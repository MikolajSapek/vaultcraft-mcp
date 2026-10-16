#!/usr/bin/env bash
# Copy the note templates from a vaultcraft checkout so both repos serve the same ones.
set -euo pipefail
src="${1:-../vaultcraft}/skills/vaultcraft/templates"
cp "${src}"/*.md "$(dirname "$0")/../templates/"
echo "templates synced from ${src}"
