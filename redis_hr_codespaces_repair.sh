#!/usr/bin/env bash
set -euo pipefail
cd /workspaces/Redis-DotNet-Lab

BACKUP="/tmp/redis-hr-compose-$(date +%Y%m%d-%H%M%S).yaml"
cp compose.yaml "$BACKUP"
echo "Mevcut compose yedeklendi: $BACKUP"

cat > compose.yaml <<'YAML'
name: redis-hr-lab
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: redislab
      POSTGRES_USER: lab
      POSTGRES_PASSWORD: local_dev_only
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/001-init.sql:ro
    ports:
      - "127.0.0.1:5080:8080"
      - "127.0.0.1:5540:5540"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U lab -d redislab"]
      interval: 5s
      timeout: 3s
      retries: 25

  redis:
    image: redis:8-alpine
    network_mode: "service:postgres"
    depends_on:
      postgres:
        condition: service_healthy
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 25

  api:
    build: .
    network_mode: "service:postgres"
    environment:
      ConnectionStrings__Postgres: "Host=127.0.0.1;Port=5432;Database=redislab;Username=lab;Password=local_dev_only"
      ConnectionStrings__Redis: "127.0.0.1:6379"
      ASPNETCORE_URLS: "http://+:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  redisinsight:
    image: redis/redisinsight:latest
    profiles: ["tools"]
    network_mode: "service:postgres"
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - insightdata:/data

volumes:
  pgdata:
  redisdata:
  insightdata:
YAML

# Dashboard and integration-test properties must match the actual C# API payload.
python3 - <<'PY'
from pathlib import Path
p = Path('src/RedisLab.Api/wwwroot/app.js')
s = p.read_text()
replacements = {
    'r.redis.avgMs': 'r.redisAvgMs',
    'r.postgres.avgMs': 'r.postgresAvgMs',
    'r.redis.p95Ms': 'r.redisP95Ms',
    'r.postgres.p95Ms': 'r.postgresP95Ms',
}
for old, new in replacements.items():
    s = s.replace(old, new)
p.write_text(s)

p = Path('scripts/smoke_test.py')
s = p.read_text().replace("bench['redis']['avgMs']", "bench['redisAvgMs']")
p.write_text(s)
print('Dashboard ve entegrasyon testi alan adlari senkronize edildi.')
PY

# Stops no named data volumes; recreates containers only.
docker compose config -q
printf '\n--- Containerlar yeniden olusturuluyor (volumeler korunuyor) ---\n'
docker compose up -d --build --force-recreate
printf '\n--- Servis durumu ---\n'
docker compose ps
printf '\n--- API durumunu kontrol et ---\n'
python3 - <<'PY'
import json, time, urllib.request
for i in range(20):
    try:
        with urllib.request.urlopen('http://localhost:5080/api/status', timeout=8) as r:
            data=json.load(r)
        print(json.dumps(data, ensure_ascii=False, indent=2))
        if (data.get('postgresOnline') is True and data.get('redisOnline') is True
                and data.get('totalEmployees') == 10000):
            print('OK: .NET + PostgreSQL + Redis iletisim kuruyor; 10000 calisan bulundu.')
            break
    except Exception as exc:
        print('API henuz hazir degil:',str(exc)[:150])
    time.sleep(2)
else:
    raise SystemExit('SERVIS KONTROLU BASARISIZ. docker compose logs --tail=100 api redis postgres komutunu calistir.')
PY

printf '\n--- Uctan uca entegrasyon testi ---\n'
python3 scripts/smoke_test.py

printf '\n--- GitHub degisikliklerini kaydet ---\n'
git add compose.yaml src/RedisLab.Api/wwwroot/app.js scripts/smoke_test.py
if ! git diff --cached --quiet; then
    if git commit -m 'fix: restore Codespaces network connectivity and Redis dashboard tests'; then
        git push origin HEAD:main || echo 'GitHub push basarisiz; uygulama calisiyor ama degisiklikler uzak repoya aktarilamadi.'
    fi
fi
printf '\nBASARILI: http://localhost:5080 (Codespaces PORTS -> 5080)\n'
