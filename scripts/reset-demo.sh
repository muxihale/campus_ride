#!/usr/bin/env bash
# Full demo reset: drop + recreate schema, seed, and create the demo rides.
# Usage: scripts/reset-demo.sh YYYY-MM-DD   (date must be in the future)
set -euo pipefail
cd "$(dirname "$0")/.."
DEMO_DATE="${1:?Usage: scripts/reset-demo.sh YYYY-MM-DD}"
(cd apps/api && bunx prisma migrate reset --force)
bun run db:seed
DEMO_DATE="$DEMO_DATE" bun scripts/prepare-defense.mjs
