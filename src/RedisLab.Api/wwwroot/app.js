'use strict';
const $ = id => document.getElementById(id);
const number = v => new Intl.NumberFormat('tr-TR').format(v ?? 0);
const money = v => new Intl.NumberFormat('tr-TR', {style:'currency',currency:'TRY',maximumFractionDigits:0}).format(v ?? 0);
const small = v => new Intl.NumberFormat('tr-TR',{maximumFractionDigits:3}).format(v ?? 0);
const bytes = v => v >= 1048576 ? `${small(v / 1048576)} MB` : v >= 1024 ? `${small(v / 1024)} KB` : `${number(v)} B`;
let page = 1, pages = 1, editing = null, toastTimer, searchTimer, refreshing = false;

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store', // Browser HTTP cache yerine Redis katmanını ölçeriz.
    ...options,
    headers: {'Content-Type':'application/json', ...(options.headers || {})}
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.detail || `HTTP ${response.status}`);
  return data;
}
function toast(message, error=false) {
  const node = $('toast'); node.textContent = message;
  node.className = `toast ${error ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.add('hidden'), 4200);
}
function log(message) {
  const host = $('event-list');
  if (host.querySelector('.empty')) host.replaceChildren();
  const row = document.createElement('div'); row.className = 'event';
  const label = document.createElement('span'); label.textContent = message;
  const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString('tr-TR');
  row.append(label, time); host.prepend(row);
  while (host.children.length > 12) host.lastElementChild.remove();
}
function configureTheme() {
  let theme = 'light';
  try { theme = localStorage.getItem('hrlab-theme') === 'dark' ? 'dark' : 'light'; } catch (_) {}
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').textContent = theme === 'dark' ? '☀ Açık tema' : '☾ Koyu tema';
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('hrlab-theme', next); } catch (_) {}
  $('theme-toggle').textContent = next === 'dark' ? '☀ Açık tema' : '☾ Koyu tema';
}

async function status() {
  try {
    const s = await api('/api/status');
    $('count').textContent = number(s.totalEmployees);
    $('rate').textContent = small(s.hitRate) + '%';
    $('hits').textContent = number(s.hits);
    $('misses').textContent = number(s.misses);
    $('service').textContent = s.postgresOnline && s.redisOnline ? '● Tüm sistemler aktif' : '● Servis kontrolü gerekli';
    $('service').classList.toggle('offline', !s.postgresOnline || !s.redisOnline);
    return s;
  } catch (error) {
    $('service').textContent = '● API bağlantı hatası'; $('service').classList.add('offline');
    throw error;
  }
}
async function summary(fresh=false) {
  const {data,source,elapsedMs} = await api('/api/summary' + (fresh ? '?fresh=true' : ''));
  $('avg').textContent = money(data.averageSalary);
  $('payroll').textContent = money(data.totalPayroll);
  $('age').textContent = small(data.averageAge);
  $('dept-total').textContent = number(data.departments.length);
  $('summary-source').textContent = `${source} (${small(elapsedMs)} ms)`;
  const max = Math.max(1,...data.departments.map(x=>x.count));
  const host = $('departments'); host.replaceChildren();
  for (const d of data.departments) {
    const row = document.createElement('div'); row.className = 'dept-row';
    const label = document.createElement('label'); label.textContent = d.name;
    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = 100 * d.count / max + '%'; bar.append(fill);
    const count = document.createElement('span'); count.textContent = number(d.count);
    row.append(label,bar,count); host.append(row);
  }
  const genders = $('gender-bars'); genders.replaceChildren();
  for (const g of data.genders) {
    const percent = data.employeeCount ? 100 * g.count / data.employeeCount : 0;
    const row = document.createElement('div'); row.className = 'gender-item';
    const line = document.createElement('div');
    const a = document.createElement('span'); a.textContent = g.name;
    const b = document.createElement('span'); b.textContent = small(percent) + '%';
    line.append(a,b);
    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = percent + '%'; bar.append(fill);
    row.append(line,bar); genders.append(row);
  }
  return {source,elapsedMs};
}
async function employees() {
  const q = new URLSearchParams({page, pageSize:12, search:$('search').value,
    department:$('filter-dept').value, gender:$('filter-gender').value});
  const result = await api('/api/employees?' + q);
  pages = Math.max(1,result.pages);
  $('table-count').textContent = number(result.total) + ' çalışan';
  $('page-info').textContent = `Sayfa ${page} / ${pages}`;
  $('prev').disabled = page <= 1; $('next').disabled = page >= pages;
  const host = $('employee-rows'); host.replaceChildren();
  for (const emp of result.employees) {
    const tr = document.createElement('tr');
    const cell = (value) => {const td=document.createElement('td');td.textContent=value;tr.append(td);return td;};
    const name = cell('');
    const heading = document.createElement('b'); heading.textContent = emp.fullName;
    const sub = document.createElement('small'); sub.textContent = '#' + emp.id;
    name.append(heading,sub);
    cell(emp.department); cell(emp.position); cell(emp.age); cell(emp.gender); cell(money(emp.salary));
    const td = cell('');
    const button = document.createElement('button');button.className='tableaction';button.textContent='Düzenle';
    button.onclick = () => edit(emp);td.append(button);host.append(tr);
  }
  if (!result.employees.length) {
    const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;
    td.textContent='Eşleşen çalışan bulunamadı.';tr.append(td);host.append(tr);
  }
}
function edit(employee) {
  editing=employee;$('editor').classList.remove('hidden');
  $('edit-person').textContent=`#${employee.id} · ${employee.fullName} — Maaş güncelle`;
  $('edit-salary').value=employee.salary;
  $('editor').scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function save() {
  if (!editing) return;
  const amount=Number($('edit-salary').value);
  if (!Number.isFinite(amount) || amount<1000 || amount>1000000) return toast('Maaş 1.000–1.000.000 TL olmalı.',true);
  try {
    const result=await api(`/api/employees/${editing.id}/salary`,{method:'PATCH',body:JSON.stringify({salary:amount})});
    $('editor').classList.add('hidden');editing=null;
    await Promise.all([employees(),summary(true),status()]);
    log('Maaş güncellendi · cache invalidation: ' + (result.cacheInvalidated?'başarılı':'Redis erişimi yok'));
    toast(result.warning || 'Maaş güncellendi, özet PostgreSQL’den yenilendi.',!!result.warning);
  } catch(e) { toast('Maaş kaydı: '+e.message,true); }
}
const currentId = () => Number($('lookup-id').value);
async function lookup(id=currentId()) {
  if (!Number.isInteger(id) || id<1 || id>10000) return toast('1–10.000 arasında ID gir.',true);
  $('lookup-id').value=id;
  try {
    const r=await api(`/api/employees/${id}`);
    const host=$('lookup-result');host.replaceChildren();
    const title=document.createElement('div');title.className='result-title';
    const badge=document.createElement('span');badge.className='source '+(r.source==='Redis'?'':'miss');
    badge.textContent=r.source==='Redis'?'● REDIS · CACHE HIT':'● POSTGRESQL · CACHE MISS';
    const ms=document.createElement('strong');ms.textContent=small(r.elapsedMs)+' ms';title.append(badge,ms);
    const detail=document.createElement('div');detail.className='result-detail';
    const left=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small');
    name.textContent=r.employee.fullName;meta.textContent=r.employee.department+' · '+r.employee.position;
    left.append(name,meta);const right=document.createElement('div');right.textContent=money(r.employee.salary);
    detail.append(left,right);host.append(title,detail);
    log(`#${id} · ${r.source} · ${small(r.elapsedMs)} ms`);
    await Promise.allSettled([status(),inspect(),redisStats()]);
  } catch(e) {toast('Çalışan sorgusu: '+e.message,true);}
}
async function warmup() {
  const btn=$('warmup');btn.disabled=true;
  try {
    const count=Number($('warmup-size').value);
    const r=await api(`/api/cache/warmup?count=${count}`,{method:'POST'});
    log(`${number(r.loaded)} çalışan Redis'e yüklendi · ${small(r.elapsedMs)} ms`);
    toast(`${number(r.loaded)} kayıt Redis'e yüklendi.`);
    await Promise.allSettled([redisStats(),inspect()]);
  } catch(e) {toast('Warm-up: '+e.message,true);}finally{btn.disabled=false;}
}
async function reset() {
  const btn=$('reset');btn.disabled=true;
  try {
    const r=await api('/api/cache/reset',{method:'POST'});
    log('Cache namespace reset · v'+r.cacheVersion);
    toast('Cache sürümü yenilendi. Sonraki çalışan sorgusu MISS olacaktır.');
    await Promise.allSettled([inspect(),redisStats()]);
  } catch(e) {toast('Cache reset: '+e.message,true);}finally{btn.disabled=false;}
}
async function benchmark() {
  const btn=$('bench');btn.disabled=true;btn.textContent='◷ Ölçülüyor...';
  try {
    const id=currentId() || 42;
    const r=await api(`/api/benchmark/${id}?runs=25`);
    const host=$('bench-result');host.replaceChildren();
    const grid=document.createElement('div');grid.className='compare';
    for (const [name,value] of [['Redis',r.redisAvgMs],['PostgreSQL',r.postgresAvgMs]]) {
      const col=document.createElement('div');col.textContent=name;
      const strong=document.createElement('strong');strong.textContent=small(value)+' ms';col.append(strong);grid.append(col);
    }
    const note=document.createElement('small');
    note.textContent=`${r.runs} tekrar · Redis / PostgreSQL süre oranı ${small(r.speedup)}× · P95 Redis ${small(r.redisP95Ms)} ms / PostgreSQL ${small(r.postgresP95Ms)} ms. Tek istemcili laboratuvar testi.`;
    host.append(grid,note);log(`Benchmark #${id} · ${small(r.speedup)}×`);
  } catch(e) {toast('Benchmark: '+e.message,true);}finally{btn.disabled=false;btn.textContent='◷ Benchmark (25 ×)';}
}
async function redisStats() {
  const r=await api('/api/redis/stats');
  $('redis-memory').textContent=bytes(r.memoryBytes);
  $('redis-keys').textContent=number(r.databaseKeys);
  $('redis-keyspace').textContent=`${number(r.redisHits)} / ${number(r.redisMisses)}`;
  $('redis-eviction').textContent=`${number(r.evictedKeys)} / ${number(r.expiredKeys)}`;
  return r;
}
async function inspect() {
  const id=currentId();
  if (!Number.isInteger(id) || id<1 || id>10000) return;
  const r=await api(`/api/cache/inspect/${id}`);
  const host=$('inspect-result');host.replaceChildren();
  const key=document.createElement('strong');key.textContent=r.key;
  const line=document.createElement('div');line.textContent=r.exists
    ? `CACHE HIT MÜMKÜN · TTL: ${number(r.ttlSeconds)} sn · Veri: ${bytes(r.valueBytes)}`
    : 'CACHE MISS · Bu key henüz Redis üzerinde bulunmuyor.';
  const hint=document.createElement('small');hint.textContent='Cache reset sonrasında versiyon değişir. Eski anahtarlar kendi TTL sürelerinin sonunda silinir.';
  host.append(key,line,hint);
}
async function counter() {
  const r=await api('/api/redis/counter');
  $('counter-value').textContent=number(r.value);
  $('counter-ttl').textContent=number(r.ttlSeconds);
  return r;
}
async function incrementCounter() {
  const btn=$('counter-increment');btn.disabled=true;
  try {
    const r=await api('/api/redis/counter/increment',{method:'POST'});
    $('counter-value').textContent=number(r.value);
    $('counter-ttl').textContent=number(r.ttlSeconds);
    log(`Redis INCR → ${number(r.value)}`);
    await redisStats();
  } catch(e) {toast('Redis INCR: '+e.message,true);}finally{btn.disabled=false;}
}
async function refreshDashboard() {
  if(refreshing)return;
  refreshing=true;
  const btn=$('refresh');btn.disabled=true;btn.textContent='↻ Yenileniyor...';
  const results=await Promise.allSettled([status(),summary(true),employees(),redisStats(),counter(),inspect()]);
  const errors=results.filter(x=>x.status==='rejected');
  if (errors.length) {
    toast(`Yenilemede ${errors.length} bölüm hata verdi: ${errors[0].reason?.message ?? 'Bilinmeyen hata'}`,true);
  } else {
    $('last-refresh').textContent=new Date().toLocaleTimeString('tr-TR');
    toast('Veriler PostgreSQL’den tazelendi; Redis metrikleri güncellendi.');
    log('Manuel yenileme: PostgreSQL + Redis telemetri');
  }
  btn.textContent='↻ Verileri Yenile';btn.disabled=false;refreshing=false;
}
async function init() {
  configureTheme();
  try {
    const depts=await api('/api/departments');
    for (const name of depts) {const option=document.createElement('option');option.value=name;option.textContent=name;$('filter-dept').append(option);}
  } catch(e) {toast('Departman listesi: '+e.message,true);}
  const results=await Promise.allSettled([status(),summary(),employees(),redisStats(),counter(),inspect()]);
  if(results.every(r=>r.status==='fulfilled')) $('last-refresh').textContent=new Date().toLocaleTimeString('tr-TR');
  else toast('Bazı bölümler yüklenemedi. Yenile düğmesiyle tekrar dene.',true);
}
$('theme-toggle').onclick=toggleTheme;
$('refresh').onclick=refreshDashboard;
$('redis-refresh').onclick=async()=>{try{await Promise.all([redisStats(),counter(),inspect()]);toast('Redis metrikleri güncellendi.');}catch(e){toast(e.message,true);}};
$('inspect').onclick=async()=>{try{await inspect();}catch(e){toast(e.message,true);}};
$('counter-increment').onclick=incrementCounter;
$('counter-refresh').onclick=async()=>{try{await counter();}catch(e){toast(e.message,true);}};
$('search').oninput=()=>{clearTimeout(searchTimer);page=1;searchTimer=setTimeout(()=>employees().catch(e=>toast(e.message,true)),250);};
$('filter-dept').onchange=$('filter-gender').onchange=()=>{page=1;employees().catch(e=>toast(e.message,true));};
$('clear-filters').onclick=()=>{$('search').value='';$('filter-dept').value='';$('filter-gender').value='';page=1;employees().catch(e=>toast(e.message,true));};
$('prev').onclick=()=>{if(page>1){page--;employees().catch(e=>toast(e.message,true));}};
$('next').onclick=()=>{if(page<pages){page++;employees().catch(e=>toast(e.message,true));}};
$('cancel').onclick=()=>{$('editor').classList.add('hidden');editing=null;};
$('save').onclick=save;
$('lookup').onclick=()=>lookup();
document.querySelectorAll('.quick button').forEach(btn=>btn.onclick=()=>lookup(Number(btn.dataset.id)));
$('warmup').onclick=warmup;
$('reset').onclick=reset;
$('bench').onclick=benchmark;
$('clear-events').onclick=()=>{$('event-list').replaceChildren();const empty=document.createElement('div');empty.className='empty';empty.textContent='İşlem yapıldığında burada görünecek.';$('event-list').append(empty);};
init();
setInterval(()=>{status().catch(()=>{});redisStats().catch(()=>{});},20000);
