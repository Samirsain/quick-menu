#!/usr/bin/env bash
# Runs every migration plus the SQL checks on a throwaway local Postgres (no Docker, no Supabase project touched).
#   bash supabase/tests/run_local.sh
# Needs initdb / pg_ctl / psql on PATH. Prints "ALL CHECKS PASSED" twice on success, exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")/../.."

DIR="$(mktemp -d)"
PORT=54329
trap 'pg_ctl -D "$DIR/db" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

initdb -D "$DIR/db" -U postgres -A trust >/dev/null
pg_ctl -D "$DIR/db" -o "-p $PORT -c listen_addresses=localhost -c wal_level=logical" -l "$DIR/log" -w start >/dev/null

run() { psql -h localhost -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }

run -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/*.sql; do
  case "$f" in *seed*) continue ;; esac # seed data needs a real signed-up owner
  run -f "$f"
done
run -f supabase/tests/rls_check.sql
run -f supabase/tests/v2_check.sql
