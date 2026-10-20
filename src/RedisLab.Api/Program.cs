using System.Diagnostics;
using System.Text.Json;
using Npgsql;
using StackExchange.Redis;

const int EmployeeTtlSeconds = 300;
const int SummaryTtlSeconds = 60;
const string EpochKey = "hrlab:epoch";

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException("Postgres connection is missing")));
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
{
    var config = ConfigurationOptions.Parse(builder.Configuration.GetConnectionString("Redis")
        ?? throw new InvalidOperationException("Redis connection is missing"));
    config.AbortOnConnectFail = false;
    config.ConnectRetry = 3;
    // Yalnızca yerel Redis Lab sunucu istatistikleri için.
    config.AllowAdmin = true;
    return ConnectionMultiplexer.Connect(config);
});
builder.Services.AddSingleton<Metrics>();
var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/status", async (NpgsqlDataSource pg, IConnectionMultiplexer redis, Metrics metrics) =>
{
    var pgOnline = false;
    var redisOnline = false;
    long count = 0;
    try
    {
        await using var cmd = pg.CreateCommand("SELECT count(*) FROM employees");
        count = (long)(await cmd.ExecuteScalarAsync() ?? 0L);
        pgOnline = true;
    }
    catch (Exception ex) when (ex is NpgsqlException or TimeoutException) { app.Logger.LogWarning("PostgreSQL health kontrolü başarısız: {ErrorType}", ex.GetType().Name); }
    try { await redis.GetDatabase().PingAsync(); redisOnline = true; }
    catch (Exception ex) when (ex is RedisException or TimeoutException) { app.Logger.LogWarning("Redis health kontrolü başarısız: {ErrorType}", ex.GetType().Name); }
    return Results.Ok(new { postgresOnline = pgOnline, redisOnline, totalEmployees = count,
        hits = metrics.Hits, misses = metrics.Misses, writes = metrics.Writes,
        hitRate = metrics.Hits + metrics.Misses == 0 ? 0 : Math.Round(100.0 * metrics.Hits / (metrics.Hits + metrics.Misses), 1),
        ttlSeconds = EmployeeTtlSeconds });
});

app.MapGet("/api/departments", () => Results.Ok(new[] { "Yazılım", "Siber Güvenlik", "Network", "Veri & AI", "İnsan Kaynakları", "Finans", "Operasyon", "Satış" }));

app.MapGet("/api/employees", async (string? search, string? department, string? gender, int? page, int? pageSize, NpgsqlDataSource pg) =>
{
    int p = Math.Clamp(page ?? 1, 1, 100000), size = Math.Clamp(pageSize ?? 12, 1, 50);
    string s = (search ?? "").Trim(), dept = department ?? "", sex = gender ?? "";
    if (s.Length > 80) return Results.BadRequest(new { error = "Arama çok uzun." });
    const string where = "WHERE (@term = '' OR full_name ILIKE '%' || @term || '%' OR position ILIKE '%' || @term || '%' OR CAST(id AS text) = @term) AND (@dept = '' OR department = @dept) AND (@sex = '' OR gender = @sex)";
    await using var cmd = pg.CreateCommand($"SELECT id,full_name,department,position,gender,age,salary,start_date FROM employees {where} ORDER BY id LIMIT @size OFFSET @offset");
    Filters(cmd, s, dept, sex);
    cmd.Parameters.AddWithValue("size", size);
    cmd.Parameters.AddWithValue("offset", (p - 1) * size);
    var data = new List<Employee>();
    await using (var reader = await cmd.ExecuteReaderAsync()) while (await reader.ReadAsync()) data.Add(Read(reader));
    await using var countCommand = pg.CreateCommand($"SELECT count(*) FROM employees {where}");
    Filters(countCommand, s, dept, sex);
    var count = (long)(await countCommand.ExecuteScalarAsync() ?? 0L);
    return Results.Ok(new { employees = data, total = count, page = p, pageSize = size, pages = (int)Math.Ceiling(count / (double)size) });
});

app.MapGet("/api/employees/{id:int}", async (int id, NpgsqlDataSource pg, IConnectionMultiplexer redis, Metrics metrics) =>
{
    if (id <= 0) return Results.BadRequest(new { error = "ID pozitif olmalı." });
    var watch = Stopwatch.StartNew();
    var cache = redis.GetDatabase();
    string? key = null;
    try
    {
        key = await CacheKey(cache, id);
        var raw = await cache.StringGetAsync(key);
        if (raw.HasValue)
        {
            var emp = JsonSerializer.Deserialize<Employee>(raw.ToString());
            if (emp != null)
            {
                metrics.Hit();
                return Results.Ok(new { employee = emp, source = "Redis", elapsedMs = Elapsed(watch) });
            }
        }
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException or JsonException) { }
    metrics.Miss();
    var employee = await Fetch(pg, id);
    if (employee is null) return Results.NotFound(new { error = "Çalışan bulunamadı." });
    if (key != null)
    {
        try { await cache.StringSetAsync(key, JsonSerializer.Serialize(employee), TimeSpan.FromSeconds(EmployeeTtlSeconds)); }
        catch (Exception ex) when (ex is RedisException or TimeoutException) { }
    }
    return Results.Ok(new { employee, source = "PostgreSQL", elapsedMs = Elapsed(watch) });
});

app.MapGet("/api/summary", async (bool? fresh, NpgsqlDataSource pg, IConnectionMultiplexer redis) =>
{
    var watch = Stopwatch.StartNew();
    var cache = redis.GetDatabase();
    string? key = null;
    try
    {
        key = $"hrlab:summary:v{await Epoch(cache)}";
        var raw = await cache.StringGetAsync(key);
        if (fresh != true && raw.HasValue)
        {
            var saved = JsonSerializer.Deserialize<Summary>(raw.ToString());
            if (saved != null) return Results.Ok(new { data = saved, source = "Redis", elapsedMs = Elapsed(watch) });
        }
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException or JsonException) { }
    var summary = await GetSummary(pg);
    if (key != null)
    {
        try { await cache.StringSetAsync(key, JsonSerializer.Serialize(summary), TimeSpan.FromSeconds(SummaryTtlSeconds)); }
        catch (Exception ex) when (ex is RedisException or TimeoutException) { }
    }
    return Results.Ok(new { data = summary, source = "PostgreSQL", elapsedMs = Elapsed(watch) });
});

app.MapPatch("/api/employees/{id:int}/salary", async (int id, SalaryChange input, NpgsqlDataSource pg, IConnectionMultiplexer redis, Metrics metrics) =>
{
    if (id <= 0 || input.Salary < 1000 || input.Salary > 1000000)
        return Results.BadRequest(new { error = "Maaş 1.000–1.000.000 TL arasında olmalı." });
    await using var cmd = pg.CreateCommand("UPDATE employees SET salary=@salary,updated_at=now() WHERE id=@id RETURNING id,full_name,department,position,gender,age,salary,start_date");
    cmd.Parameters.AddWithValue("salary", input.Salary);
    cmd.Parameters.AddWithValue("id", id);
    Employee? updated;
    await using (var reader = await cmd.ExecuteReaderAsync()) updated = await reader.ReadAsync() ? Read(reader) : null;
    if (updated is null) return Results.NotFound();
    metrics.Write();
    bool invalidated = false;
    try
    {
        var cache = redis.GetDatabase();
        var version = await Epoch(cache);
        await Task.WhenAll(cache.KeyDeleteAsync($"hrlab:employee:v{version}:{id}"), cache.KeyDeleteAsync($"hrlab:summary:v{version}"));
        invalidated = true;
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException) { }
    return Results.Ok(new { employee = updated, cacheInvalidated = invalidated,
        warning = invalidated ? null : "Redis çevrimdışı: eski cache TTL dolana kadar görülebilir." });
});

app.MapPost("/api/cache/warmup", async (int? count, NpgsqlDataSource pg, IConnectionMultiplexer redis) =>
{
    var take = Math.Clamp(count ?? 100, 1, 10000);
    var watch = Stopwatch.StartNew();
    await using var cmd = pg.CreateCommand("SELECT id,full_name,department,position,gender,age,salary,start_date FROM employees ORDER BY id LIMIT @take");
    cmd.Parameters.AddWithValue("take", take);
    var employees = new List<Employee>();
    await using (var reader = await cmd.ExecuteReaderAsync()) while (await reader.ReadAsync()) employees.Add(Read(reader));
    try
    {
        var cache = redis.GetDatabase();
        var version = await Epoch(cache);
        for (var offset = 0; offset < employees.Count; offset += 250)
        {
            var batch = cache.CreateBatch();
            var tasks = employees.Skip(offset).Take(250).Select(e => batch.StringSetAsync(
                $"hrlab:employee:v{version}:{e.Id}", JsonSerializer.Serialize(e), TimeSpan.FromSeconds(EmployeeTtlSeconds))).ToList();
            batch.Execute();
            await Task.WhenAll(tasks);
        }
        return Results.Ok(new { loaded = employees.Count, ttlSeconds = EmployeeTtlSeconds, elapsedMs = Elapsed(watch) });
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException) { return Results.Problem("Redis bağlantısı yok.", statusCode: 503); }
});

app.MapPost("/api/cache/reset", async (IConnectionMultiplexer redis) =>
{
    try
    {
        long version = await redis.GetDatabase().StringIncrementAsync(EpochKey);
        return Results.Ok(new { cacheVersion = version, message = "Cache namespace güncellendi; eski kayıtlar TTL ile silinecek." });
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException) { return Results.Problem("Redis bağlantısı yok.", statusCode: 503); }
});

app.MapGet("/api/benchmark/{id:int}", async (int id, int? runs, NpgsqlDataSource pg, IConnectionMultiplexer redis) =>
{
    if (id < 1) return Results.BadRequest();
    var employee = await Fetch(pg, id);
    if (employee is null) return Results.NotFound();
    int n = Math.Clamp(runs ?? 25, 5, 100);
    try
    {
        var cache = redis.GetDatabase();
        var key = await CacheKey(cache, id);
        await cache.StringSetAsync(key, JsonSerializer.Serialize(employee), TimeSpan.FromSeconds(EmployeeTtlSeconds));
        await Fetch(pg, id);
        await cache.StringGetAsync(key);
        var pgSamples = new List<double>();
        var redisSamples = new List<double>();
        for (int i = 0; i < n; i++)
        {
            var clock = Stopwatch.StartNew();
            _ = await Fetch(pg, id);
            pgSamples.Add(clock.Elapsed.TotalMilliseconds);
            clock.Restart();
            var cached = await cache.StringGetAsync(key);
            if (!cached.HasValue) return Results.Problem("Cache boş.", statusCode: 503);
            _ = JsonSerializer.Deserialize<Employee>(cached.ToString());
            redisSamples.Add(clock.Elapsed.TotalMilliseconds);
        }
        var pgAverage = Math.Round(pgSamples.Average(), 3);
        var rdAverage = Math.Round(redisSamples.Average(), 3);
        return Results.Ok(new { runs = n, postgresAvgMs = pgAverage, redisAvgMs = rdAverage,
            postgresP95Ms = P95(pgSamples), redisP95Ms = P95(redisSamples),
            speedup = rdAverage > 0 ? Math.Round(pgAverage / rdAverage, 2) : 0,
            note = "Tek istemcili sentetik test; üretim benchmark'ı değildir." });
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException) { return Results.Problem("Redis bağlantısı yok.", statusCode: 503); }
});


// Redis sunucu istatistikleri: INFO ve DBSIZE sunucu-seviyesi komutlardır.
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

// Tekil cache anahtarını, kalan TTL ve JSON boyutunu denetle.
app.MapGet("/api/cache/inspect/{id:int}", async (int id, IConnectionMultiplexer redis) =>
{
    if (id < 1 || id > 10000) return Results.BadRequest(new { error = "ID 1-10000 arası olmalı." });
    try
    {
        var cache = redis.GetDatabase();
        var key = await CacheKey(cache, id);
        var value = await cache.StringGetAsync(key);
        var ttl = value.HasValue ? await cache.KeyTimeToLiveAsync(key) : null;
        return Results.Ok(new
        {
            key,
            exists = value.HasValue,
            ttlSeconds = ttl.HasValue ? (int)Math.Ceiling(ttl.Value.TotalSeconds) : 0,
            valueBytes = value.HasValue ? System.Text.Encoding.UTF8.GetByteCount(value.ToString()) : 0,
            policy = "Cache Aside | TTL 300 saniye"
        });
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException)
    {
        return Results.Problem("Redis anahtarı okunamadı.", statusCode: 503);
    }
});

// Redis INCR atomik sayaç: uygulama süreç belleğinden bağımsız.
app.MapGet("/api/redis/counter", async (IConnectionMultiplexer redis) =>
{
    try
    {
        var cache = redis.GetDatabase();
        var value = await cache.StringGetAsync("hrlab:demo:counter");
        var ttl = await cache.KeyTimeToLiveAsync("hrlab:demo:counter");
        return Results.Ok(new { value = value.HasValue && long.TryParse(value.ToString(), out var n) ? n : 0L,
            ttlSeconds = ttl.HasValue ? (int)Math.Ceiling(ttl.Value.TotalSeconds) : 0 });
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException)
    {
        return Results.Problem("Redis sayacı okunamadı.", statusCode: 503);
    }
});

app.MapPost("/api/redis/counter/increment", async (IConnectionMultiplexer redis) =>
{
    try
    {
        var cache = redis.GetDatabase();
        const string key = "hrlab:demo:counter";
        var count = await cache.StringIncrementAsync(key);
        var ttl = await cache.KeyTimeToLiveAsync(key);
        if (ttl is null) await cache.KeyExpireAsync(key, TimeSpan.FromMinutes(10));
        return Results.Ok(new { value = count, ttlSeconds = (int)Math.Ceiling(
            (await cache.KeyTimeToLiveAsync(key))?.TotalSeconds ?? 0) });
    }
    catch (Exception ex) when (ex is RedisException or TimeoutException)
    {
        return Results.Problem("Redis sayacı artırılamadı.", statusCode: 503);
    }
});

app.Run();

static Dictionary<string, string> ParseRedisInfo(string info)
{
    var result = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach (var line in info.Split('\n'))
    {
        var trimmed = line.Trim();
        if (trimmed.Length == 0 || trimmed.StartsWith('#')) continue;
        var colon = trimmed.IndexOf(':');
        if (colon > 0) result[trimmed[..colon]] = trimmed[(colon + 1)..].Trim();
    }
    return result;
}
static long InfoNumber(Dictionary<string, string> info, string key) =>
    info.TryGetValue(key, out var raw) && long.TryParse(raw, out var value) ? value : 0L;

static Employee Read(NpgsqlDataReader r) => new(r.GetInt32(0), r.GetString(1), r.GetString(2),
    r.GetString(3), r.GetString(4), r.GetInt32(5), r.GetDecimal(6), r.GetDateTime(7));
static void Filters(NpgsqlCommand cmd, string term, string dept, string sex)
{
    cmd.Parameters.AddWithValue("term", term);
    cmd.Parameters.AddWithValue("dept", dept);
    cmd.Parameters.AddWithValue("sex", sex);
}
static async Task<Employee?> Fetch(NpgsqlDataSource pg, int id)
{
    await using var cmd = pg.CreateCommand("SELECT id,full_name,department,position,gender,age,salary,start_date FROM employees WHERE id=@id");
    cmd.Parameters.AddWithValue("id", id);
    await using var reader = await cmd.ExecuteReaderAsync();
    return await reader.ReadAsync() ? Read(reader) : null;
}
static async Task<Summary> GetSummary(NpgsqlDataSource pg)
{
    long total;
    decimal avgSalary, payroll, avgAge;
    await using (var cmd = pg.CreateCommand("SELECT count(*),COALESCE(round(avg(salary),2),0),COALESCE(sum(salary),0),COALESCE(round(avg(age),1),0) FROM employees"))
    {
        await using var r = await cmd.ExecuteReaderAsync();
        await r.ReadAsync();
        total = r.GetInt64(0);
        avgSalary = r.GetDecimal(1);
        payroll = r.GetDecimal(2);
        avgAge = r.GetDecimal(3);
    }
    var depts = new List<DepartmentStat>();
    await using (var cmd = pg.CreateCommand("SELECT department,count(*),round(avg(salary),2),sum(salary) FROM employees GROUP BY department ORDER BY count(*) DESC,department"))
    {
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) depts.Add(new DepartmentStat(r.GetString(0), r.GetInt64(1), r.GetDecimal(2), r.GetDecimal(3)));
    }
    var genders = new List<GenderStat>();
    await using (var cmd = pg.CreateCommand("SELECT gender,count(*) FROM employees GROUP BY gender ORDER BY gender"))
    {
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync()) genders.Add(new GenderStat(r.GetString(0), r.GetInt64(1)));
    }
    return new Summary(total, avgSalary, payroll, avgAge, depts, genders);
}
static async Task<string> Epoch(IDatabase cache)
{
    var raw = await cache.StringGetAsync("hrlab:epoch");
    return raw.HasValue ? raw.ToString() : "0";
}
static async Task<string> CacheKey(IDatabase cache, int id) => $"hrlab:employee:v{await Epoch(cache)}:{id}";
static double Elapsed(Stopwatch watch) => Math.Round(watch.Elapsed.TotalMilliseconds, 3);
static double P95(List<double> samples)
{
    samples.Sort();
    return Math.Round(samples[(int)Math.Ceiling(samples.Count * 0.95) - 1], 3);
}
record Employee(int Id, string FullName, string Department, string Position, string Gender,
    int Age, decimal Salary, DateTime StartDate);
record SalaryChange(decimal Salary);
record DepartmentStat(string Name, long Count, decimal AverageSalary, decimal TotalPayroll);
record GenderStat(string Name, long Count);
record Summary(long EmployeeCount, decimal AverageSalary, decimal TotalPayroll, decimal AverageAge,
    List<DepartmentStat> Departments, List<GenderStat> Genders);
sealed class Metrics
{
    private long _hits, _misses, _writes;
    public long Hits => Interlocked.Read(ref _hits);
    public long Misses => Interlocked.Read(ref _misses);
    public long Writes => Interlocked.Read(ref _writes);
    public void Hit() => Interlocked.Increment(ref _hits);
    public void Miss() => Interlocked.Increment(ref _misses);
    public void Write() => Interlocked.Increment(ref _writes);
}
