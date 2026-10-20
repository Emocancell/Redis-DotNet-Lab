#!/usr/bin/env bash
# Redis HR Lab V2: safe upgrade of demo names + Redis features.
# Does not remove Docker volumes or reset real test salaries.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f compose.yaml || ! -f db/migrations/002_fix_demo_names.sql ]]; then
  echo "HATA: Projenin ana klasorunde degilsiniz veya V2 dosyalari eksik." >&2
  exit 1
fi

echo "[1/5] Compose yapilandirmasi"
docker compose config -q

echo "[2/5] PostgreSQL/Redis servisleri kontrol ediliyor"
docker compose up -d postgres redis

echo "[3/5] Mevcut 10000 sentetik calisan ismi duzeltiliyor"
echo "Maaş, departman, yaş, cinsiyet ve id alanlarına dokunulmayacak."
docker compose exec -T postgres psql -v ON_ERROR_STOP=1 \
  -U lab -d redislab < db/migrations/002_fix_demo_names.sql

echo "[4/5] .NET API V2 derleniyor ve baglaniyor"
docker compose up --build -d api
python3 - <<'PY'
import json, time, urllib.request
for attempt in range(45):
    try:
        with urllib.request.urlopen('http://localhost:5080/api/status',timeout=6) as response:
            status=json.load(response)
        if status.get('postgresOnline') and status.get('redisOnline') and status.get('totalEmployees') == 10000:
            print('OK: API, PostgreSQL, Redis ve 10000 kayit aktif.')
            break
    except Exception:
        pass
    time.sleep(2)
else:
    raise SystemExit('API baglantisi saglanamadi. docker compose logs --tail=100 api')
PY

echo "[5/5] Eski cache sürümü geçersiz kılınıyor (veriler silinmeden)"
curl -fsS -X POST http://localhost:5080/api/cache/reset
printf '\n--- Entegrasyon testleri ---\n'
python3 scripts/smoke_test.py
printf '\nBASARILI: Redis HR Lab V2 -> PORTS 5080\n'
echo "GitHub'a istersen: git add . && git commit -m 'feat: Redis HR Lab v2' && git push"
