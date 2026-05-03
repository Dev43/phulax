#!/usr/bin/env bash
# Fix KeeperHub's workflow-postgres-setup failure caused by a bug in
# @workflow/world-postgres@4.1.0-beta.51's migration set:
#
#   -- Update any paused runs to cancelled
#   UPDATE "workflow"."workflow_runs" SET "status" = 'cancelled' WHERE "status" = 'paused';
#
# The status enum is created on the same fresh DB without 'paused', and
# Postgres validates enum literals at parse time — so the UPDATE errors
# even though the table is empty. drizzle wraps every migration in a
# transaction and rolls back on failure, so we can't simply ALTER after
# a failed run; the schema never persists.
#
# Strategy: patch the offending .sql migration file inside the migrator
# container before running pnpm db:setup. Because docker run starts a
# fresh container every time, we do the patch + setup in the same shell
# invocation.
#
# Run from /opt/phulax on the box:
#   bash deploy/fix-kh-db.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f docker-compose.yml ]]; then
    echo "ERROR: docker-compose.yml not found in $REPO_ROOT"
    exit 1
fi

run_psql() {
    docker compose exec -T db psql -U postgres -d keeperhub "$@"
}

echo "==> Step 1: drop any half-built workflow schema from prior attempts"
run_psql -c "DROP SCHEMA IF EXISTS workflow CASCADE;" || true

echo
echo "==> Step 2: patch the bad migration file in the migrator container, then run pnpm db:setup"
# The migration file is at:
#   /app/node_modules/.pnpm/@workflow+world-postgres@<...>/node_modules/@workflow/world-postgres/src/drizzle/migrations/*.sql
# One of those .sql files contains the offending UPDATE. We grep for the
# comment marker, sed-comment the UPDATE, then run the setup all in the same
# container session so the patched file is in effect.
docker compose --profile init run --rm keeperhub-migrate sh <<'INNER'
set -e
ROOT_GLOB='/app/node_modules/.pnpm/@workflow+world-postgres*/node_modules/@workflow/world-postgres/src/drizzle/migrations'
DIR=$(echo $ROOT_GLOB | head -1)
echo "Migration dir: $DIR"
ls "$DIR" | head
BADFILE=$(grep -l 'Update any paused runs' "$DIR"/*.sql 2>/dev/null | head -1)
if [ -z "$BADFILE" ]; then
  echo "Could not locate bad migration file under $DIR"
  echo "Listing all .sql files there:"
  ls "$DIR"/*.sql
  exit 1
fi
echo "Patching: $BADFILE"
echo "--- before ---"
cat "$BADFILE"
# Comment out the offending UPDATE so the migration becomes effectively a
# no-op (the table is empty on a fresh DB anyway).
sed -i 's|^UPDATE "workflow"\."workflow_runs" SET "status" = '\''cancelled'\'' WHERE "status" = '\''paused'\'';|-- patched-out by phulax fix-kh-db.sh: paused not in initial enum|' "$BADFILE"
echo "--- after ---"
cat "$BADFILE"
echo
echo "Running pnpm db:setup with patched migration..."
pnpm db:setup
INNER

echo
echo "==> Step 3: verify the workflow schema is in place"
run_psql -c "
SELECT n.nspname AS schema, t.typname AS enum_name,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'workflow'
GROUP BY n.nspname, t.typname;"

run_psql -c "\dt workflow.*"

echo
echo "==> Step 4: turn on world-postgres in .env (idempotent)"
if grep -q '^WORKFLOW_TARGET_WORLD=' .env 2>/dev/null; then
    sed -i 's|^WORKFLOW_TARGET_WORLD=.*|WORKFLOW_TARGET_WORLD=@workflow/world-postgres|' .env
else
    echo 'WORKFLOW_TARGET_WORLD=@workflow/world-postgres' >> .env
fi
grep WORKFLOW_TARGET_WORLD .env

echo
echo "==> Step 5: recreate KH so it boots with the postgres-backed runtime + in-process worker"
docker compose up -d --force-recreate keeperhub
sleep 5
docker compose ps keeperhub
docker compose logs --tail 20 keeperhub
