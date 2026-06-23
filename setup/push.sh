#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Scrubbing credentials..."
node "$ROOT/setup/scrub-creds.js"

echo "→ Pushing..."
git -C "$ROOT" push "$@"
PUSH_EXIT=$?

echo "→ Restoring credentials..."
node "$ROOT/setup/restore-creds.js"

exit $PUSH_EXIT
