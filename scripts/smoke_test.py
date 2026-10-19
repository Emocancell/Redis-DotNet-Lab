#!/usr/bin/env python3
"""Standard-library integration test, runs against the Docker Compose web app."""
import json, time, urllib.request
BASE = 'http://localhost:5080'

def request(path, method='GET', payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

for i in range(60):
    try:
        s = request('/api/status')
        if s['postgresOnline'] and s['redisOnline']: break
    except Exception: pass
    time.sleep(2)
else: raise RuntimeError('Services did not become healthy')
assert s['totalEmployees'] == 10000, s
assert request('/api/employees?pageSize=5')['total'] == 10000
assert request('/api/employees?department=Network')['total'] > 0
assert request('/api/summary')['data']['employeeCount'] == 10000
request('/api/cache/reset', 'POST')
a = request('/api/employees/42')
b = request('/api/employees/42')
assert a['source'] == 'PostgreSQL', a
assert b['source'] == 'Redis', b
old = b['employee']['salary']
new = old + 123
changed = request('/api/employees/42/salary', 'PATCH', {'salary': new})
assert changed['cacheInvalidated']
c = request('/api/employees/42')
assert c['source'] == 'PostgreSQL' and c['employee']['salary'] == new, c
warm = request('/api/cache/warmup?count=100', 'POST')
assert warm['loaded'] == 100
assert request('/api/employees/42')['source'] == 'Redis'
bench = request('/api/benchmark/42?runs=5')
assert bench['runs'] == 5 and bench['redisAvgMs'] >= 0
request('/api/employees/42/salary', 'PATCH', {'salary': old})
print('PASS: health, seed, list/filter, summary, miss/hit, salary/cache invalidation, warm-up, benchmark')
