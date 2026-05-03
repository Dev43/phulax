#!/usr/bin/env bash
# Fix KeeperHub's workflow-postgres-setup failure caused by the
# @workflow/world-postgres@4.1.0-beta.51 migration that does
#   UPDATE workflow.workflow_runs SET status='cancelled' WHERE status='paused';
# on a fresh DB where the enum was created without 'paused' (Postgres
# validates enum literals at parse time, so the UPDATE errors with
# "invalid input value for enum status: paused" even though the table is empty).
#
# Run from /opt/phulax on the box:
#   chmod +x deploy/fix-kh-db.sh && bash deploy/fix-kh-db.sh
#
# It's idempotent — safe to re-run.

set -euo pipefail

# Resolve the repo root via BASH_SOURCE so the script works under `bash file`,
# `./file`, or being run from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f docker-compose.yml ]]; then
    echo "ERROR: docker-compose.yml not found in $REPO_ROOT"
    echo "Make sure you ran 'git pull' and that the file exists at the repo root."
    exit 1
fi

run_psql() {
    docker compose exec -T db psql -U postgres -d keeperhub "$@"
}

echo "==> Step 1: inspect what enums exist in the workflow schema"
run_psql -c "
SELECT n.nspname AS schema, t.typname AS enum_name,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'workflow'
GROUP BY n.nspname, t.typname;
" || echo "(workflow schema may not exist yet — that's fine)"

echo
echo "==> Step 2: ALTER every enum in workflow schema to add 'paused' if missing"
# Loop over every enum in workflow schema and ADD VALUE 'paused' IF NOT EXISTS.
# Wrapped in a DO block so we don't have to know the exact enum name in advance.
run_psql -c "
DO \$\$
DECLARE
  e record;
BEGIN
  FOR e IN
    SELECT n.nspname AS schema, t.typname AS enum_name
    FROM pg_type t
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'workflow' AND t.typtype = 'e'
  LOOP
    BEGIN
      EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', e.schema, e.enum_name, 'paused');
      RAISE NOTICE 'patched enum %.%', e.schema, e.enum_name;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'skipping %.% (%): %', e.schema, e.enum_name, SQLSTATE, SQLERRM;
    END;
  END LOOP;
END
\$\$;
" || echo "(no workflow schema yet — proceeding to setup)"

echo
echo "==> Step 3: re-run pnpm db:setup (migrations + workflow setup + seeds)"
if docker compose --profile init run --rm keeperhub-migrate pnpm db:setup; then
    echo
    echo "==> SUCCESS: db:setup completed."
    echo "==> Step 4: restart keeperhub so it picks up the now-healthy DB"
    docker compose restart keeperhub
    sleep 3
    docker compose ps keeperhub
    exit 0
fi

echo
echo "==> db:setup still failing. Falling back to migrate-only path."
echo "==> This drops the half-built workflow schema and runs only KH's own"
echo "==> drizzle migrations + seeds. KH UI will load; workflow execution"
echo "==> won't work (would need to bump @workflow/world-postgres)."
read -rp "Proceed with migrate-only fallback? [y/N] " yn
case "$yn" in
    [yY]*) ;;
    *) echo "Aborted."; exit 1 ;;
esac

run_psql -c "DROP SCHEMA IF EXISTS workflow CASCADE;"
docker compose --profile init run --rm keeperhub-migrate sh -c "pnpm db:migrate && pnpm db:seed"
docker compose restart keeperhub
sleep 3
docker compose ps keeperhub
echo
echo "==> Migrate-only path done. KH UI should be reachable; workflow runtime is offline."
