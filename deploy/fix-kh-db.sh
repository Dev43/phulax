#!/usr/bin/env bash
# Fix KeeperHub's workflow-postgres-setup failure caused by the
# @workflow/world-postgres@4.1.0-beta.51 migration that does
#   UPDATE workflow.workflow_runs SET status='cancelled' WHERE status='paused';
# on a fresh DB where the enum was created without 'paused' (Postgres
# validates enum literals at parse time, so the UPDATE errors with
# "invalid input value for enum status: paused" even though the table is empty).
#
# Strategy (drizzle commits each migration file in its own transaction, so
# earlier migrations persist when a later one fails):
#   1. Run setup once — fails at the bad UPDATE, but the schema/enum exists
#   2. ALTER the enum to add 'paused'
#   3. Re-run setup — bad migration now parses (matches 0 rows) and the rest
#      of the migrations apply cleanly
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

run_migrate() {
    docker compose --profile init run --rm keeperhub-migrate "$@"
}

patch_workflow_enums() {
    run_psql -c "
DO \$\$
DECLARE e record;
BEGIN
  FOR e IN
    SELECT n.nspname AS schema, t.typname AS enum_name
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'workflow' AND t.typtype = 'e'
  LOOP
    BEGIN
      EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', e.schema, e.enum_name, 'paused');
      RAISE NOTICE 'patched %.% (added paused)', e.schema, e.enum_name;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skip %.% (%): %', e.schema, e.enum_name, SQLSTATE, SQLERRM;
    END;
  END LOOP;
END
\$\$;
"
}

echo "==> Pass 1: run pnpm db:setup (expected to fail at the paused-enum migration; that's fine — it creates the schema)"
run_migrate pnpm db:setup || echo "  (pass 1 failed as expected — schema/enum should now exist)"

echo
echo "==> Inspect: enums in workflow schema after pass 1"
run_psql -c "
SELECT n.nspname AS schema, t.typname AS enum_name,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'workflow'
GROUP BY n.nspname, t.typname;" || true

echo
echo "==> Patch: ALTER every workflow enum to ADD VALUE 'paused' IF NOT EXISTS"
patch_workflow_enums

echo
echo "==> Pass 2: re-run pnpm db:setup (should succeed past the previously-failing migration)"
if run_migrate pnpm db:setup; then
    echo
    echo "==> SUCCESS: workflow-postgres schema is in place."
    echo "==> Restart KH so it picks up WORKFLOW_TARGET_WORLD=@workflow/world-postgres"
    docker compose up -d --force-recreate keeperhub
    sleep 5
    docker compose ps keeperhub
    exit 0
fi

echo
echo "==> Pass 2 still failing. Inspecting current state:"
run_psql -c "
SELECT n.nspname AS schema, t.typname AS enum_name,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'workflow'
GROUP BY n.nspname, t.typname;" || true

echo
echo "==> Falling back to migrate-only (KH UI works, no workflow execution)."
read -rp "Proceed with migrate-only fallback? [y/N] " yn
case "$yn" in [yY]*) ;; *) echo "Aborted."; exit 1 ;; esac

run_psql -c "DROP SCHEMA IF EXISTS workflow CASCADE;"
run_migrate sh -c "pnpm db:migrate && pnpm db:seed"
docker compose up -d --force-recreate keeperhub
echo
echo "==> Migrate-only path done. KH UI reachable; workflows won't execute."
