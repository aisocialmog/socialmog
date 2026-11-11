#!/usr/bin/env bash
# Local helper: start the throwaway Postgres if needed, run the DB tests, print only problems + pass lines.
pg_isready -q -h /var/tmp/smog-pg -p 5433 || { rm -f /var/tmp/smog-pg/data/postmaster.pid; su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/smog-pg/data -o '-k /var/tmp/smog-pg -p 5433' -l /var/tmp/smog-pg/log -w start" >/dev/null; }
PGHOST=/var/tmp/smog-pg PGPORT=5433 PGUSER=postgres "$(dirname "$0")/test-db.sh" 2>&1 | grep -i "error\|fail\|PASSED\|CONTEXT\|LINE\|\^\|HINT\|DETAIL" | grep -v "NOTICE:  ok" | tail -${1:-14}
