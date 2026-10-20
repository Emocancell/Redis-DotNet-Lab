'use strict';
// V3 browser-only UI: every control has a visible result, including API errors.
const $ = id => document.getElementById(id);
const fmt = n => new Intl.NumberFormat('tr-TR').format(n ?? 0);
const money = n => new Intl.NumberFormat('tr-TR', {style:'currency', currency:'TRY', maximumFractionDigits:0}).format(n ?? 0);
const dec = n => new Intl.NumberFormat('tr-TR', {maximumFractionDigits:3}).format(n ?? 0);
const prettyBytes = n => n >= 1048576 ? dec(n/1048576)+' MB' : n >= 1024 ? dec(n/1024)+' KB' : fmt(n)+' B';
const state = { page:1, pages:1, selected:null, editing:null, refreshing:false, searchTimer:null, toastTimer:null, departments:[] };

async function api(path, options={}) {
  const response = await fetch(path, {cache:'no-store', ...options,
    headers:{'Content-Type':'application/json', ...(options.headers || {})}});
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || data.detail || data.title || `HTTP ${response.status}`);
  return data;
}
function toast(message, isError=false) {
  const t = $('toast');
  t.textContent = message;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(()=>t.classList.add('hidden'), 6500);
}
function logEvent(message) {
  const container = $('event-list');
  if (!container.querySelector('.event')) container.replaceChildren();
  const row = document.createElement('div'); row.className = 'event';
  const span = document.createElement('span'); span.textContent = message;
  const time = document.createElement('time'); time.textContent = new Date().toLocaleTimeString('tr-TR');
  row.append(span,time); container.prepend(row);
  while (container.children.length > 15) container.lastElementChild.remove();
}
const makeEl = (tag, text, cls) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = String(text);
  if (cls) el.className = cls;
  return el;
};

function applyTheme(value) {
  const theme = value === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  $('theme-toggle').textContent = theme === 'dark' ? '☀ Açık tema' : '☾ Koyu tema';
  try { localStorage.setItem('redis-hr-v3-theme', theme); } catch (_) {}
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  toast(next === 'light' ? 'Açık tema etkin.' : 'Koyu tema etkin.');
}

async function loadStatus() {
  const s = await api('/api/status');
  $('total-employees').textContent = fmt(s.totalEmployees);
  $('hit-rate').textContent = dec(s.hitRate) + '%';
  $('hits').textContent = fmt(s.hits);
  $('misses').textContent = fmt(s.misses);
  const ok = s.redisOnline && s.postgresOnline;
  $('service-status').textContent = ok ? '● Tüm sistemler aktif' : '● Bağlantı kontrol edilmeli';
  $('service-status').classList.toggle('error', !ok);
  return s;
}
async function loadSummary(fresh=false) {
  const {data, source} = await api('/api/summary' + (fresh ? '?fresh=true' : ''));
  $('avg-salary').textContent = money(data.averageSalary);
  $('total-payroll').textContent = money(data.totalPayroll);
  $('average-age').textContent = dec(data.averageAge);
  $('department-count').textContent = fmt(data.departments.length);
  const total = Math.max(1, ...data.departments.map(x=>x.count));
  const dep = $('departments');dep.replaceChildren();
  data.departments.forEach(d=>{
    const row=makeEl('div',undefined,'bar-row');
    const label=makeEl('span',d.name), bar=makeEl('div',undefined,'bar-track');
    const fill=makeEl('i');fill.style.width = (100*d.count/total)+'%';bar.append(fill);
    row.append(label,bar,makeEl('strong',fmt(d.count)));dep.append(row);
  });
  const genders=$('genders');genders.replaceChildren();
  data.genders.forEach(g=>{
    const row=makeEl('div',undefined,'bar-row');
    const percent=data.employeeCount ? 100*g.count/data.employeeCount : 0;
    const bar=makeEl('div',undefined,'bar-track'),fill=makeEl('i');
    fill.style.width=percent+'%';bar.append(fill);
    row.append(makeEl('span',g.name),bar,makeEl('strong',dec(percent)+'%'));genders.append(row);
  });
  return source;
}
async function loadEmployees() {
  const params = new URLSearchParams({page:state.page,pageSize:12,search:$('search').value,
    department:$('filter-dept').value,gender:$('filter-gender').value});
  const r=await api('/api/employees?'+params);
  state.pages=Math.max(1,r.pages);
  $('filtered-total').textContent=fmt(r.total)+' kayıt';
  $('page-label').textContent=`Sayfa ${state.page} / ${state.pages}`;
  $('prev').disabled=state.page<=1;$('next').disabled=state.page>=state.pages;
  const body=$('employee-rows');body.replaceChildren();
  for(const emp of r.employees){
    const row=makeEl('tr');
    const name=makeEl('td');name.append(makeEl('b',emp.fullName),makeEl('small','#'+emp.id));row.append(name);
    for(const value of [emp.department,emp.position,emp.age,emp.gender,money(emp.salary)]) row.append(makeEl('td',value));
    const action=makeEl('td');const btn=makeEl('button','Düzenle','table-edit');btn.type='button';
    btn.addEventListener('click',()=>openForm(emp));action.append(btn);row.append(action);body.append(row);
  }
  if(!r.employees.length){const tr=makeEl('tr'),td=makeEl('td','Eşleşen çalışan bulunamadı.');td.colSpan=7;tr.append(td);body.append(tr);}
}
function selectId() {
  const n=Number($('lookup-id').value);
  if(!Number.isSafeInteger(n) || n<1) throw new Error('Pozitif çalışan ID girin.');
  return n;
}
async function queryEmployee() {
  const id=selectId();
  const r=await api(`/api/employees/${id}`);
  state.selected=r.employee;
  const result=$('lookup-result');result.replaceChildren();
  const source=makeEl('div',r.source==='Redis'?'● Redis CACHE HIT':'● PostgreSQL CACHE MISS',r.source==='Redis'?'hit':'miss');
  result.append(source,makeEl('strong',r.employee.fullName),makeEl('div',r.employee.department+' · '+r.employee.position),
    makeEl('div',money(r.employee.salary)+' · '+dec(r.elapsedMs)+' ms'));
  logEvent(`#${id} ${r.source} · ${dec(r.elapsedMs)} ms`);
  const checks=await Promise.allSettled([loadStatus(),inspectKey(),loadRedisStats()]);
  checks.filter(x=>x.status==='rejected').forEach(x=>console.warn(x.reason));
}
async function loadRedisStats() {
  try {
    const s=await api('/api/redis/stats');
    $('redis-memory').textContent=prettyBytes(s.memoryBytes);
    $('redis-keys').textContent=fmt(s.databaseKeys);
    $('redis-keyspace').textContent=`${fmt(s.redisHits)} / ${fmt(s.redisMisses)}`;
    $('redis-eviction').textContent=`${fmt(s.evictedKeys)} / ${fmt(s.expiredKeys)}`;
    $('redis-error').textContent='Redis INFO / DBSIZE son güncelleme: '+new Date().toLocaleTimeString('tr-TR');
    return s;
  } catch (e) {
    $('redis-error').textContent='Telemetri hatası: '+e.message;
    throw e;
  }
}
async function inspectKey() {
  const id=selectId();
  const r=await api(`/api/cache/inspect/${id}`);
  const out=$('inspect-result');out.replaceChildren();
  out.append(makeEl('strong',r.key));
  out.append(makeEl('div',r.exists
    ? `CACHE VAR · TTL: ${fmt(r.ttlSeconds)} saniye · Boyut: ${prettyBytes(r.valueBytes)}`
    : 'CACHE MISS · Bu çalışan için güncel namespace içinde henüz key yok.'));
  return r;
}
async function loadCounter() {
  const r=await api('/api/redis/counter');
  $('counter-value').textContent=fmt(r.value);$('counter-ttl').textContent=fmt(r.ttlSeconds);
  return r;
}
async function incrementCounter() {
  const r=await api('/api/redis/counter/increment',{method:'POST'});
  $('counter-value').textContent=fmt(r.value);$('counter-ttl').textContent=fmt(r.ttlSeconds);
  logEvent('Redis INCR → '+r.value);
  await loadRedisStats();
}
async function warmup() {
  const count=Number($('warmup-size').value);
  const r=await api(`/api/cache/warmup?count=${count}`,{method:'POST'});
  toast(`${fmt(r.loaded)} kayıt Redis'e yüklendi.`);logEvent('Warm-up '+fmt(r.loaded)+' kayıt');
  await Promise.allSettled([loadRedisStats(),inspectKey()]);
}
async function resetCache() {
  const r=await api('/api/cache/reset',{method:'POST'});
  toast('Cache sürümü değiştirildi. Sonraki sorgu MISS olacaktır.');
  logEvent('Namespace reset v'+r.cacheVersion);
  await Promise.allSettled([inspectKey(),loadRedisStats()]);
}
async function benchmark() {
  const id=selectId();
  const r=await api(`/api/benchmark/${id}?runs=25`);
  const out=$('benchmark-result');out.replaceChildren();
  out.append(makeEl('div',`Redis ortalama: ${dec(r.redisAvgMs)} ms`),
    makeEl('div',`PostgreSQL ortalama: ${dec(r.postgresAvgMs)} ms`),
    makeEl('strong',`Oran: ${dec(r.speedup)}×`),
    makeEl('small',`P95 Redis: ${dec(r.redisP95Ms)} ms | PostgreSQL: ${dec(r.postgresP95Ms)} ms`));
  logEvent('Benchmark #'+id+' · '+dec(r.speedup)+'×');
}

function splitName(emp) {
  const source=String(emp.fullName||'').replace(new RegExp('\\s+'+emp.id+'$'),'').trim();
  const names=source.split(/\s+/);
  return {first:names.slice(0,-1).join(' ')||names[0]||'', last:names.length>1?names[names.length-1]:''};
}
function openForm(emp=null) {
  state.editing=emp;
  $('employee-form').reset();
  $('modal-title').textContent=emp?`Çalışanı düzenle · #${emp.id}`:'Yeni çalışan ekle';
  $('delete-employee').classList.toggle('hidden',!emp);
  $('form-save').textContent=emp?'Değişiklikleri kaydet':'Yeni çalışan oluştur';
  if(emp){
    const name=splitName(emp);
    $('f-first').value=name.first;$('f-last').value=name.last;
    $('f-age').value=emp.age;$('f-gender').value=emp.gender;
    $('f-dept').value=emp.department;$('f-position').value=emp.position;
    $('f-salary').value=emp.salary;$('f-start').value=String(emp.startDate).slice(0,10);
  } else {
    const now = new Date();
    $('f-start').value = [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
  }
  $('modal-backdrop').classList.remove('hidden');
  $('f-first').focus();
}
function closeForm(){ $('modal-backdrop').classList.add('hidden');state.editing=null; }
function readForm(){
  return {
    firstName:$('f-first').value.trim(),lastName:$('f-last').value.trim(),
    age:Number($('f-age').value),gender:$('f-gender').value,
    department:$('f-dept').value,position:$('f-position').value.trim(),
    salary:Number($('f-salary').value),startDate:$('f-start').value
  };
}
async function submitForm(event) {
  event.preventDefault();
  if(!$('employee-form').reportValidity()) return;
  const edit=state.editing;
  const btn=$('form-save');btn.disabled=true;
  try {
    const r=await api(edit?`/api/employees/${edit.id}`:'/api/employees',{
      method:edit?'PUT':'POST',body:JSON.stringify(readForm())
    });
    closeForm();state.page=1;
    await refreshAll();
    logEvent(edit?`Çalışan #${r.employee.id} güncellendi`:`Yeni çalışan #${r.employee.id} eklendi`);
    toast(r.warning || (edit?'Çalışan bilgileri güncellendi.':'Yeni çalışan kaydedildi.'),!!r.warning);
  } catch(e){toast('Kaydetme hatası: '+e.message,true);}
  finally{btn.disabled=false;}
}
async function deleteEmployee() {
  const emp=state.editing;if(!emp)return;
  if(!window.confirm(`#${emp.id} · ${emp.fullName} adlı demo çalışanı kalıcı olarak silmek istiyor musun?`))return;
  const btn=$('delete-employee');btn.disabled=true;
  try {
    const r=await api(`/api/employees/${emp.id}`,{method:'DELETE'});
    closeForm();state.page=1;
    await refreshAll();
    logEvent('Çalışan #'+r.deletedId+' silindi');
    toast(r.warning||'Demo çalışan kaydı silindi.',!!r.warning);
  } catch(e){toast('Silme hatası: '+e.message,true);}finally{btn.disabled=false;}
}

async function refreshAll() {
  if(state.refreshing)return;
  state.refreshing=true;
  const btn=$('refresh-all');btn.disabled=true;btn.textContent='↻ Yenileniyor...';
  try {
    const steps=await Promise.allSettled([loadStatus(),loadSummary(true),loadEmployees(),loadRedisStats(),loadCounter()]);
    const errors=steps.filter(x=>x.status==='rejected');
    $('last-refresh').textContent='Son yenileme: '+new Date().toLocaleTimeString('tr-TR');
    if(errors.length) toast('Bazı bölümler güncellenemedi: '+errors[0].reason.message,true);
    else {toast('Tüm veriler ve Redis metrikleri tazelendi.');logEvent('Dashboard manuel yenilendi');}
  } finally {
    btn.disabled=false;btn.textContent='↻ Verileri yenile';state.refreshing=false;
  }
}

function bind(id, event, cb) {
  const el=$(id);
  if(!el) throw new Error('HTML kontrolü eksik: '+id);
  el.addEventListener(event, (...args)=>{
    Promise.resolve().then(()=>cb(...args)).catch(e=>{console.error(e);toast(e.message,true);});
  });
}
async function init() {
  let saved='light';try{saved=localStorage.getItem('redis-hr-v3-theme')||'light';}catch(_){}
  applyTheme(saved);
  bind('theme-toggle','click',toggleTheme);
  bind('refresh-all','click',refreshAll);
  bind('add-employee','click',()=>openForm());
  bind('modal-close','click',closeForm);bind('form-cancel','click',closeForm);
  bind('employee-form','submit',submitForm);
  bind('delete-employee','click',deleteEmployee);
  bind('lookup','click',queryEmployee);
  document.querySelectorAll('[data-quick]').forEach(el=>el.addEventListener('click',()=>{
    $('lookup-id').value=el.dataset.quick;queryEmployee().catch(e=>toast(e.message,true));
  }));
  bind('redis-refresh','click',async()=>{await loadRedisStats();toast('Redis metrikleri güncellendi.');});
  bind('inspect','click',inspectKey);
  bind('counter-refresh','click',async()=>{await loadCounter();toast('Sayaç durumu güncellendi.');});
  bind('counter-increment','click',incrementCounter);
  bind('warmup','click',warmup);
  bind('reset-cache','click',resetCache);
  bind('benchmark','click',benchmark);
  bind('clear-events','click',()=>{$('event-list').textContent='İşlem geçmişi temizlendi.';});
  bind('prev','click',async()=>{if(state.page>1){state.page--;await loadEmployees();}});
  bind('next','click',async()=>{if(state.page<state.pages){state.page++;await loadEmployees();}});
  bind('clear-filters','click',async()=>{
    $('search').value='';$('filter-dept').value='';$('filter-gender').value='';state.page=1;await loadEmployees();
  });
  bind('search','input',()=>{
    clearTimeout(state.searchTimer);state.page=1;
    state.searchTimer=setTimeout(()=>loadEmployees().catch(e=>toast(e.message,true)),300);
  });
  bind('filter-dept','change',async()=>{state.page=1;await loadEmployees();});
  bind('filter-gender','change',async()=>{state.page=1;await loadEmployees();});
  bind('modal-backdrop','click',e=>{if(e.target.id==='modal-backdrop')closeForm();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeForm();});
  try{
    state.departments=await api('/api/departments');
    for(const d of state.departments){
      for(const id of ['filter-dept','f-dept']){
        const opt=makeEl('option',d);opt.value=d;$(id).append(opt);
      }
    }
  } catch(e){toast('Departmanlar yüklenemedi: '+e.message,true);}
  const initSteps=await Promise.allSettled([loadStatus(),loadSummary(),loadEmployees(),loadRedisStats(),loadCounter()]);
  $('last-refresh').textContent='Son yenileme: '+new Date().toLocaleTimeString('tr-TR');
  const errs=initSteps.filter(s=>s.status==='rejected');
  if(errs.length) toast('Başlangıçta bazı bölümler yüklenemedi: '+errs[0].reason.message,true);
  setInterval(()=>{loadStatus().catch(()=>{});},30000);
}
window.addEventListener('error',e=>console.error('Redis HR V3 UI error',e.error||e.message));
init().catch(e=>{console.error(e);toast('Arayüz başlatılamadı: '+e.message,true);});
