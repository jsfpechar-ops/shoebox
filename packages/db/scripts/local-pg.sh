#!/usr/bin/env bash
# Plain Postgres 16 for the db tests where Docker (and so `supabase start`) is not available.
# Usage: packages/db/scripts/local-pg.sh start|stop|url   (needs the `postgres` OS user; runs as root or as postgres)
# After `start`, export the printed DATABASE_URL and run `pnpm test:db`.
set -euo pipefail
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDIR="${SHOEBOX_PGDIR:-/var/lib/postgresql/shoebox-local}"
PGPORT="${SHOEBOX_PGPORT:-54399}"
DBNAME="shoebox_test"
URL="postgresql://postgres@127.0.0.1:${PGPORT}/${DBNAME}"
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" = "0" ]; then AS_PG=(runuser -u postgres --); else AS_PG=(); fi

case "${1:-}" in
  start)
    if [ ! -d "$PGDIR/data" ]; then
      "${AS_PG[@]}" mkdir -p "$PGDIR"
      "${AS_PG[@]}" "$PGBIN/initdb" -D "$PGDIR/data" -U postgres --auth=trust -E UTF8 --locale=C >/dev/null
    fi
    if ! "${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" status >/dev/null 2>&1; then
      "${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" -l "$PGDIR/pg.log" \
        -o "-p $PGPORT -k $PGDIR -c listen_addresses=127.0.0.1" -w start >/dev/null
    fi
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q -tAc \
      "select 1 from pg_database where datname = '$DBNAME'" | grep -q 1 \
      || psql -h 127.0.0.1 -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q -c "create database $DBNAME"
    psql -h 127.0.0.1 -p "$PGPORT" -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 -q -f "$HERE/supabase-shim.sql"
    echo "DATABASE_URL=$URL"
    ;;
  stop)
    "${AS_PG[@]}" "$PGBIN/pg_ctl" -D "$PGDIR/data" -m fast stop >/dev/null
    echo "stopped"
    ;;
  url)
    echo "DATABASE_URL=$URL"
    ;;
  *)
    echo "usage: $0 start|stop|url" >&2
    exit 2
    ;;
esac
