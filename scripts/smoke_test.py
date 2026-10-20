#!/usr/bin/env python3
"""Redis HR V3 destructive-safe smoke test. Creates and then deletes ONE synthetic user."""
import json
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:5080"


def request(path, method="GET", payload=None):
    raw = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE+path, method=method, data=raw,
                                 headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)


for attempt in range(40):
    try:
        status = request("/api/status")
        if status.get("postgresOnline") and status.get("redisOnline"):
            break
    except (urllib.error.URLError, TimeoutError, ValueError):
        pass
    time.sleep(2)
else:
    raise RuntimeError("API veya PostgreSQL/Redis hazır değil. docker compose logs --tail=80 api")

baseline = status["totalEmployees"]
assert baseline >= 10000, status
assert request("/api/employees?pageSize=5")["total"] >= 10000
assert request("/api/summary?fresh=true")["data"]["employeeCount"] == baseline
assert request("/api/redis/stats")["memoryBytes"] > 0
counter1 = request("/api/redis/counter")["value"]
counter2 = request("/api/redis/counter/increment", "POST")["value"]
assert counter2 == counter1 + 1
request("/api/cache/reset", "POST")
assert request("/api/employees/42")["source"] == "PostgreSQL"
assert request("/api/employees/42")["source"] == "Redis"
assert request("/api/cache/inspect/42")["exists"]
assert request("/api/cache/inspect/42")["ttlSeconds"] > 0
assert request("/api/benchmark/42?runs=5")["runs"] == 5

# CRUD is verified on a dedicated test record, never on an existing employee.
new_employee = {
    "firstName":"V3Test", "lastName":"Kurgusal", "department":"Yazılım",
    "position":"Test Mühendisi", "gender":"Belirtmek istemiyor", "age":29,
    "salary":68000, "startDate":"2025-01-15"
}
created_id = None
try:
    created = request("/api/employees", "POST", new_employee)
    created_id = created["employee"]["id"]
    assert created_id > 10000, created
    assert created["cacheInvalidated"]
    assert request("/api/status")["totalEmployees"] == baseline + 1
    assert request(f"/api/employees/{created_id}")["employee"]["fullName"] == "V3Test Kurgusal"
    assert request(f"/api/employees/{created_id}")["source"] == "Redis"

    edited = dict(new_employee, firstName="Güncellendi", lastName="Personel", age=35,
                  gender="Kadın", department="Finans", salary=97500, position="Takım Lideri")
    update = request(f"/api/employees/{created_id}", "PUT", edited)
    assert update["cacheInvalidated"] and update["employee"]["age"] == 35
    after = request(f"/api/employees/{created_id}")
    assert after["source"] == "PostgreSQL", after
    assert after["employee"]["fullName"] == "Güncellendi Personel", after
    assert after["employee"]["salary"] == 97500 and after["employee"]["gender"] == "Kadın"
    assert request("/api/summary?fresh=true")["data"]["employeeCount"] == baseline + 1
finally:
    if created_id is not None:
        deleted = request(f"/api/employees/{created_id}", "DELETE")
        assert deleted["deletedId"] == created_id
        assert deleted["cacheInvalidated"]

assert request("/api/status")["totalEmployees"] == baseline
try:
    request(f"/api/employees/{created_id}")
except urllib.error.HTTPError as exc:
    assert exc.code == 404, exc.code
else:
    raise AssertionError("Deleted employee unexpectedly still exists")

print("PASS V3: 10k+ employees, Redis stats/TTL/HIT/MISS/INCR, benchmark, create/update/delete, cache invalidation, no test record left")
