#!/usr/bin/env bash
# Upgrade existing Codespaces Redis HR Lab V2 to V3 without deleting data volumes.
set -euo pipefail
cd "$(dirname "$0")/.."
export GIT_PAGER=cat

printf '\n[1/6] Gerekli dosyalar ve Docker yapilandirmasi\n'
test -f src/RedisLab.Api/HrManagementEndpoints.cs
test -f src/RedisLab.Api/wwwroot/dashboard-v3.js
test -f db/migrations/003_employee_crud.sql
docker compose config -q

printf '\n[2/6] PostgreSQL yedegi\n'
docker compose up -d postgres redis
BACKUP_DIR="${HOME}/redis-hr-backups"
mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/redislab-v3-before-$(date +%Y%m%d-%H%M%S).dump"
docker compose exec -T postgres pg_dump -U lab -d redislab -Fc > "$BACKUP"
echo "Yedek alindi: $BACKUP"

printf '\n[3/6] Yeni ID uretimi migration (mevcut kayitlar korunur)\n'
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U lab -d redislab < db/migrations/003_employee_crud.sql

printf '\n[4/6] .NET V3 Docker build\n'
docker compose up --build -d api

printf '\n[5/6] Entegrasyon testi (ekle / duzenle / sil / Redis)\n'
python3 scripts/smoke_test.py

printf '\n[6/6] GitHub guncellemesi\n'
# Only remove old frontend assets after the new API and UI were tested.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git rm -f --ignore-unmatch -- src/RedisLab.Api/wwwroot/app.js src/RedisLab.Api/wwwroot/styles.css
  git add -- README.md db/init.sql db/migrations/003_employee_crud.sql \
    src/RedisLab.Api/Program.cs src/RedisLab.Api/HrManagementEndpoints.cs \
    src/RedisLab.Api/wwwroot/index.html src/RedisLab.Api/wwwroot/dashboard-v3.js \
    src/RedisLab.Api/wwwroot/dashboard-v3.css scripts/smoke_test.py scripts/deploy_v3.sh \
    Dockerfile .dockerignore .env.example .github/workflows/ci.yml
  echo 'Commit kapsamı:'
  git --no-pager diff --cached --stat
  if ! git diff --cached --quiet; then
    git -c core.pager=cat commit -m 'feat: HR Lab V3 employee CRUD, working light theme and Redis controls'
  fi
  git push origin main
  echo 'GitHub main branch guncellendi.'
else
  echo 'Uyari: Git repository bulunamadi, push atlandi.'
fi
printf '\nBASARILI: Redis HR V3 testleri gecti. Codespaces PORTS -> 5080\n'
