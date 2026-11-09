#!/usr/bin/env bash
# Applies every migration to a throwaway local Postgres (with a stub of Supabase's
# auth schema) and runs the role/RLS smoke test. Fails on the first error.
# Usage: PGHOST=… PGPORT=… PGUSER=postgres scripts/test-db.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${DB:-smog_test}
TMP=$(mktemp -d)
# test founders replace the placeholders (the real file keeps them)
for f in supabase/migrations/*.sql; do
  sed -e 's/\[Founder 1 name\]/Founder One/; s/\[Founder 1 email\]/founder1@example.com/' \
      -e 's/\[Founder 2 name\]/Founder Two/; s/\[Founder 2 email\]/founder2@example.com/' "$f" > "$TMP/$(basename "$f")"
done
# fresh start: the test database and the stub roles (roles are cluster-wide)
psql -q -c "drop database if exists $DB" postgres
for r in app_owner anon authenticated service_role; do
  psql -q -c "drop role if exists $r" postgres 2>/dev/null || true
done
psql -q -v ON_ERROR_STOP=1 -c "create database $DB" postgres
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/local_auth_stub.sql "$DB"
psql -q -v ON_ERROR_STOP=1 -c "alter database $DB owner to app_owner" "$DB"
for f in "$TMP"/*.sql; do
  echo "· $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -U app_owner -f "$f" "$DB"
done
for t in smoke_test brands_test; do psql -q -v ON_ERROR_STOP=1 -U app_owner -f supabase/tests/$t.sql "$DB"; done
rm -rf "$TMP"
