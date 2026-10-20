#!/usr/bin/env python3
"""V2 full-stack end-to-end demo test (writes/reverts one demo salary)."""
import json
import time
import urllib.request

BASE = 'http://localhost:5080'

def request(path, method='GET', payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=20) as response:
        return json.load(response)

for attempt in range(45):
    try:
        s = request('/api/status')
        if s['postgresOnline'] and s['redisOnline']:
            break
    except Exception:
        pass
    time.sleep(2)
else:
    raise RuntimeError('Services not ready')

assert s['totalEmployees'] == 10000, s
assert request('/api/employees?pageSize=5')['total'] == 10000
assert request('/api/employees?department=Network')['total'] > 0
assert request('/api/summary?fresh=true')['source'] == 'PostgreSQL'
assert request('/api/summary')['data']['employeeCount'] == 10000
assert request('/api/redis/stats')['memoryBytes'] > 0

# Sample first names follow the *synthetic demo* labels (not real-world gender inference).
female = {'Ece','Elif','Selin','Melis','Derya','Ceren','Zeynep','Aylin','Aslı','İrem','Buse','Cansu'}
male = {'Mert','Arda','Ozan','Eren','Can','Kerem','Emre','Burak','Onur','Kaan','Mehmet','Ali'}
neutral = {'Deniz','Ekin','Özgür','Umut','Doğa','Toprak'}
for n in [1,2,10,11,42,100,101,350,9999]:
    e = request(f'/api/employees/{n}')['employee']
    first = e['fullName'].split()[0]
    valid = {'Kadın':female,'Erkek':male,'Belirtmek istemiyor':neutral}[e['gender']]
    assert first in valid, (n, first, e['gender'])

request('/api/cache/reset','POST')
a = request('/api/employees/42')
b = request('/api/employees/42')
assert a['source'] == 'PostgreSQL', a
assert b['source'] == 'Redis', b
inspection = request('/api/cache/inspect/42')
assert inspection['exists'] and inspection['ttlSeconds'] > 0 and inspection['valueBytes'] > 0, inspection
old = b['employee']['salary']
try:
    updated = request('/api/employees/42/salary','PATCH',{'salary':old+123})
    assert updated['cacheInvalidated'], updated
    c = request('/api/employees/42')
    assert c['source'] == 'PostgreSQL' and c['employee']['salary'] == old+123, c
finally:
    request('/api/employees/42/salary','PATCH',{'salary':old})
warm = request('/api/cache/warmup?count=100','POST')
assert warm['loaded'] == 100, warm
assert request('/api/employees/42')['source'] == 'Redis'
bench = request('/api/benchmark/42?runs=5')
assert bench['runs'] == 5 and bench['redisAvgMs'] >= 0
before = request('/api/redis/counter')['value']
after = request('/api/redis/counter/increment','POST')
assert after['value'] == before + 1 and after['ttlSeconds'] > 0
print('PASS V2: seed, genders, SQL filters, fresh refresh, Redis memory, TTL, HIT/MISS, salary invalidation, warmup, benchmark, INCR')
