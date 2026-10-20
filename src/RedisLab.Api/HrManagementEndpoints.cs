using Npgsql;
using StackExchange.Redis;

// Demo CRUD. PostgreSQL is the source of truth. Redis holds disposable copies.
public static class HrManagementEndpoints
{
    private static readonly string[] Departments =
    [
        "Yazılım", "Siber Güvenlik", "Network", "Veri & AI",
        "İnsan Kaynakları", "Finans", "Operasyon", "Satış"
    ];
    private static readonly string[] Genders = ["Kadın", "Erkek", "Belirtmek istemiyor"];

    public sealed record EmployeeInput(
        string? FirstName, string? LastName, string? Department, string? Position,
        string? Gender, int Age, decimal Salary, DateOnly StartDate);

    public static void MapHrRoutes(this WebApplication app)
    {
        app.MapPost("/api/employees", async (EmployeeInput input,
            NpgsqlDataSource pg, IConnectionMultiplexer redis) =>
        {
            var error = Validate(input);
            if (error is not null) return Results.BadRequest(new { error });
            var fullName = FullName(input);
            await using var cmd = pg.CreateCommand("""
                INSERT INTO employees (full_name, department, position, gender, age, salary, start_date)
                VALUES (@name, @department, @position, @gender, @age, @salary, @start)
                RETURNING id, full_name, department, position, gender, age, salary, start_date
                """);
            Add(cmd, input, fullName);
            Employee? employee;
            await using (var reader = await cmd.ExecuteReaderAsync())
                employee = await reader.ReadAsync() ? Read(reader) : null;
            if (employee is null) return Results.Problem("Çalışan oluşturulamadı.");
            var cacheInvalidated = await InvalidateAsync(redis, app.Logger);
            return Results.Created($"/api/employees/{employee.Id}", new
            {
                employee,
                cacheInvalidated,
                warning = cacheInvalidated ? null : "Redis ulaşılamadı. Önceki cache anahtarları TTL boyunca kalabilir."
            });
        });

        app.MapPut("/api/employees/{id:int}", async (int id, EmployeeInput input,
            NpgsqlDataSource pg, IConnectionMultiplexer redis) =>
        {
            if (id < 1) return Results.BadRequest(new { error = "Geçersiz çalışan ID." });
            var error = Validate(input);
            if (error is not null) return Results.BadRequest(new { error });
            await using var cmd = pg.CreateCommand("""
                UPDATE employees SET full_name=@name, department=@department,
                    position=@position, gender=@gender, age=@age,
                    salary=@salary, start_date=@start, updated_at=now()
                WHERE id=@id
                RETURNING id, full_name, department, position, gender, age, salary, start_date
                """);
            Add(cmd, input, FullName(input));
            cmd.Parameters.AddWithValue("id", id);
            Employee? employee;
            await using (var reader = await cmd.ExecuteReaderAsync())
                employee = await reader.ReadAsync() ? Read(reader) : null;
            if (employee is null) return Results.NotFound(new { error = "Çalışan bulunamadı." });
            var cacheInvalidated = await InvalidateAsync(redis, app.Logger);
            return Results.Ok(new
            {
                employee,
                cacheInvalidated,
                warning = cacheInvalidated ? null : "Redis ulaşılamadı. Önceki cache anahtarları TTL boyunca kalabilir."
            });
        });

        app.MapDelete("/api/employees/{id:int}", async (int id,
            NpgsqlDataSource pg, IConnectionMultiplexer redis) =>
        {
            if (id < 1) return Results.BadRequest(new { error = "Geçersiz çalışan ID." });
            await using var cmd = pg.CreateCommand("DELETE FROM employees WHERE id=@id");
            cmd.Parameters.AddWithValue("id", id);
            var changed = await cmd.ExecuteNonQueryAsync();
            if (changed == 0) return Results.NotFound(new { error = "Çalışan bulunamadı." });
            var cacheInvalidated = await InvalidateAsync(redis, app.Logger);
            return Results.Ok(new
            {
                deletedId = id,
                cacheInvalidated,
                warning = cacheInvalidated ? null : "Redis ulaşılamadı. Önceki cache anahtarları TTL boyunca kalabilir."
            });
        });
    }

    private static string FullName(EmployeeInput input) =>
        $"{input.FirstName!.Trim()} {input.LastName!.Trim()}";

    private static string? Validate(EmployeeInput input)
    {
        if (string.IsNullOrWhiteSpace(input.FirstName) || input.FirstName.Trim().Length > 60)
            return "Ad zorunludur (en fazla 60 karakter).";
        if (string.IsNullOrWhiteSpace(input.LastName) || input.LastName.Trim().Length > 60)
            return "Soyad zorunludur (en fazla 60 karakter).";
        if (!Departments.Contains(input.Department)) return "Geçerli bir departman seçin.";
        if (string.IsNullOrWhiteSpace(input.Position) || input.Position.Trim().Length > 80)
            return "Unvan zorunludur (en fazla 80 karakter).";
        if (!Genders.Contains(input.Gender)) return "Cinsiyet alanı geçersiz.";
        if (input.Age is < 18 or > 75) return "Yaş 18–75 arasında olmalıdır.";
        if (input.Salary is < 1000 or > 1000000) return "Maaş 1.000–1.000.000 ₺ arasında olmalıdır.";
        if (input.StartDate < new DateOnly(1980, 1, 1) || input.StartDate > DateOnly.FromDateTime(DateTime.UtcNow))
            return "İşe giriş tarihi 1980'den günümüze kadar olmalıdır.";
        return null;
    }

    private static void Add(NpgsqlCommand cmd, EmployeeInput input, string fullName)
    {
        cmd.Parameters.AddWithValue("name", fullName);
        cmd.Parameters.AddWithValue("department", input.Department!);
        cmd.Parameters.AddWithValue("position", input.Position!.Trim());
        cmd.Parameters.AddWithValue("gender", input.Gender!);
        cmd.Parameters.AddWithValue("age", input.Age);
        cmd.Parameters.AddWithValue("salary", input.Salary);
        cmd.Parameters.AddWithValue("start", input.StartDate);
    }

    private static Employee Read(NpgsqlDataReader r) => new(
        r.GetInt32(0), r.GetString(1), r.GetString(2), r.GetString(3),
        r.GetString(4), r.GetInt32(5), r.GetDecimal(6), r.GetDateTime(7));

    private static async Task<bool> InvalidateAsync(IConnectionMultiplexer redis, ILogger logger)
    {
        try
        {
            // Namespaced versioning makes employee + summary caches stale atomically.
            // Old keys expire naturally; do NOT FLUSHDB.
            await redis.GetDatabase().StringIncrementAsync("hrlab:epoch");
            return true;
        }
        catch (Exception ex) when (ex is RedisException or TimeoutException)
        {
            logger.LogWarning(ex, "Cache invalidation could not be completed");
            return false;
        }
    }
}
