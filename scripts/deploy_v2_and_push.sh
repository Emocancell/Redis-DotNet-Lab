#!/usr/bin/env bash
# Redis HR Lab V2 upgrade + GitHub publish. No volume deletion.
set -euo pipefail
cd "$(dirname "$0")/.."
echo '=== Redis HR Lab V2: Upgrade + GitHub ==='
if [[ "$(git branch --show-current)" != 'main' ]]; then
  echo 'ERROR: Expected main branch.' >&2; exit 1
fi
if ! git diff --cached --quiet; then
  echo 'ERROR: Previously staged changes exist; inspect git status first.' >&2; exit 1
fi
for f in compose.yaml scripts/upgrade_v2.sh db/migrations/002_fix_demo_names.sql; do
  if [[ ! -f "$f" ]]; then echo "Missing: $f" >&2; exit 1; fi
done

echo '[1/5] Backup PostgreSQL (no volume deletion)'
BACKUP_DIR="$(dirname "$PWD")/.redis-hr-backups"
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/redislab-before-v2-$(date +%Y%m%d-%H%M%S).dump"
docker compose up -d postgres redis
docker compose exec -T postgres pg_dump -U lab -d redislab -Fc > "$BACKUP"
echo "Backup: $BACKUP"

echo '[2/5] Upgrade database, rebuild API, run integration tests'
bash scripts/upgrade_v2.sh

echo '[3/5] Remove obsolete V1 repository files'
for old in README-old.md.md publish-to-github.ps1; do
  if git ls-files --error-unmatch "$old" >/dev/null 2>&1; then
    git rm -f -- "$old"
  fi
done

echo '[4/5] Stage only Redis HR V2 files'
git add -A -- README.md compose.yaml .dockerignore .env.example \
  src/RedisLab.Api/Program.cs src/RedisLab.Api/wwwroot \
  db/init.sql db/migrations \
  scripts/upgrade_v2.sh scripts/deploy_v2_and_push.sh scripts/smoke_test.py \
  .github/workflows/ci.yml
git diff --cached --stat
if git diff --cached --quiet; then
  echo 'Repository already up to date.'
else
  git commit -m 'feat: Redis HR Lab V2 light theme, data fix and Redis observability'
  echo '[5/5] Push to GitHub'
  git push origin main
fi
rm -f -- RedisHRLab-v2-repo.zip
echo 'SUCCESS: V2 published to GitHub after passing smoke tests.'
echo 'Dashboard: PORTS -> 5080'
