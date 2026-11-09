#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres (with a stub of Supabase's
# auth schema) and runs the smoke test. Usage: PGHOST=… PGPORT=… scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-smog_test}
psql -q -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB" postgres
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/local_auth_stub.sql "$DB"
for f in supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -f "$f" "$DB"; done
psql -q -f supabase/tests/smoke_test.sql "$DB"
