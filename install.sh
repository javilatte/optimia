#!/usr/bin/env bash
# Quick installer — no build toolchain required.
# Usage: bash install.sh [--prefix /usr/local]
set -euo pipefail

PREFIX="${PREFIX:-/usr/local}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --prefix) PREFIX="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

BINDIR="$PREFIX/bin"
SCRIPT="$(dirname "$0")/bin/optimia"

if [[ ! -f "$SCRIPT" ]]; then
    echo "Error: bin/optimia not found. Run from the optimia project directory."
    exit 1
fi

if [[ ! -w "$BINDIR" ]]; then
    echo "Note: $BINDIR is not writable — trying with sudo."
    sudo install -Dm 755 "$SCRIPT" "$BINDIR/optimia"
else
    install -Dm 755 "$SCRIPT" "$BINDIR/optimia"
fi

echo "Installed → $BINDIR/optimia"
echo "Run: optimia --help"
