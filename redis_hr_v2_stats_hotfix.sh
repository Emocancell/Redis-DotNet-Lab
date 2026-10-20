#!/usr/bin/env bash
# Redis HR Lab V2 hotfix: server-level Redis INFO/DBSIZE, rebuild, test, GitHub push.
# Preserves PostgreSQL data and Docker volumes.
set -euo pipefail
cd /workspaces/Redis-DotNet-Lab
python3 - <<'PY'
from pathlib import Path

source = Path('src/RedisLab.Api/Program.cs')
code = source.read_text(encoding='utf-8')
start = '// Redis INFO / DB size: Redis komutlarını gösteren gözlem paneli.'
end = '// Tekil cache anahtarını, kalan TTL ve JSON boyutunu denetle.'
if start not in code or end not in code:
    raise SystemExit('Beklenen V2 Redis istatistik endpointi bulunamadı; dosyaya dokunulmadı.')
if 'config.AllowAdmin = true;' not in code:
    if 'config.ConnectRetry = 3;' not in code:
        raise SystemExit('Redis bağlantı ayarı bulunamadı; dosyaya dokunulmadı.')
    code = code.replace('config.ConnectRetry = 3;',
                        'config.ConnectRetry = 3;\n    // Yalnızca yerel Redis Lab sunucu istatistikleri için.\n    config.AllowAdmin = true;', 1)

replacement = '''// Redis sunucu istatistikleri: INFO ve DBSIZE sunucu-seviyesi komutlardır.
app.MapGet("/api/redis/stats", async (IConnectionMultiplexer redis) =>
{
    try
    {
        var endpoint = redis.GetEndPoints().FirstOrDefault();
        if (endpoint is null)
            return Results.Problem("Redis sunucu adresi bulunamadı.", statusCode: 503);

        var server = redis.GetServer(endpoint);
        var memoryInfo = await server.InfoAsync("memory");
        var statisticsInfo = await server.InfoAsync("stats");
        var memory = memoryInfo.SelectMany(group => group)
            .ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
        var stats = statisticsInfo.SelectMany(group => group)
            .ToDictionary(item => item.Key, item => item.Value, StringComparer.Ordinal);
        var totalKeys = await server.DatabaseSizeAsync(0);

        return Results.Ok(new
        {
            databaseKeys = totalKeys,
            memoryBytes = InfoNumber(memory, "used_memory"),
            memoryPeakBytes = InfoNumber(memory, "used_memory_peak"),
            maxMemoryBytes = InfoNumber(memory, "maxmemory"),
            redisHits = InfoNumber(stats, "keyspace_hits"),
            redisMisses = InfoNumber(stats, "keyspace_misses"),
            evictedKeys = InfoNumber(stats, "evicted_keys"),
            expiredKeys = InfoNumber(stats, "expired_keys")
        });
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Redis istatistikleri alınamadı");
        return Results.Problem("Redis istatistikleri okunamadı; ayrıntı API loglarında.", statusCode: 503);
    }
});

'''
start_at = code.index(start)
end_at = code.index(end, start_at)
code = code[:start_at] + replacement + code[end_at:]
source.write_text(code, encoding='utf-8')
print('OK: Program.cs Redis istatistik endpointi ve bağlantı ayarı düzeltildi.')
PY

# The V2 deployment script safely rebuilds, runs integration tests, and pushes to main only after PASS.
if [[ -f scripts/deploy_v2_and_push.sh ]]; then
    bash scripts/deploy_v2_and_push.sh
else
    echo 'V2 yayınlama scripti bulunamadı; yalnızca API derlenip test edilecek.'
    docker compose up --build -d api
    python3 scripts/smoke_test.py
fi
