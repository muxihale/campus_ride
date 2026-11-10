#!/usr/bin/env bash
# Start the local demo stack (PostgreSQL + API + web) if it is not running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN=/home/max/pg26/usr/lib/postgresql/17/bin
PGLIB=/home/max/pg26/usr/lib/x86_64-linux-gnu
PGDATA=/home/max/pgdata
BUN=/home/max/.bun/bin/bun
mkdir -p /tmp/opencode

port_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

if ! port_open 5432; then
  echo "Starting PostgreSQL…"
  env -i PATH=/usr/bin:/bin HOME=/home/max LD_LIBRARY_PATH="$PGLIB" \
    "$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/opencode/pg.log \
    -o "-p 5432 -k /tmp -c listen_addresses=127.0.0.1" -w start
fi

if ! port_open 3001; then
  echo "Starting API…"
  cd "$ROOT"
  nohup "$BUN" apps/api/dist/main.js > /tmp/opencode/api.log 2>&1 &
fi

if ! port_open 5173; then
  echo "Starting web…"
  cd "$ROOT/apps/web"
  nohup "$BUN" node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 --strictPort \
    > /tmp/opencode/vite.log 2>&1 &
fi

for _ in $(seq 1 20); do
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:3001/api/health/ready || true)
  web=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:5173/ || true)
  [ "$api" = 200 ] && [ "$web" = 200 ] && { echo "Stack ready: api $api, web $web"; exit 0; }
  sleep 1
done

echo "Stack did not become ready: api ${api:-?}, web ${web:-?}" >&2
exit 1
