# Redis HR Lab V3 — People Intelligence

.NET 10, PostgreSQL 17, Redis 8 ve Docker Compose ile geliştirilmiş **tamamen sentetik personel yönetimi ve Redis performans laboratuvarı**. V3 sürümü; çalışan ekleme, bütün alanları güncelleme, silme, açık/koyu tema, gerçek yenile, Redis TTL/INCR/INFO/DBSIZE ve cache HIT/MISS testlerini içerir.

> **Güvenlik:** Bu bir geliştirme demosudur. Herhangi bir giriş/kimlik doğrulama veya rol tabanlı yetki bulunmaz. Yalnızca Codespaces **Private** portundan veya izole geliştirme ortamında kullanın. Gerçek personel/maaş verisi yüklemeyin.

## V3'te değişenler

- **Çalışan CRUD:** Ad, soyad, yaş, cinsiyet (kullanıcı girişi), departman, unvan, brüt maaş ve işe giriş tarihi alanlarında ekle, düzenle, sil.
- **10.000+ kayıt:** Önceki çalışanlar ve maaşları korunur; yeni eklenen kayıtlara PostgreSQL sequence aracılığıyla ID atanır.
- **Gerçek yenile:** `GET /api/summary?fresh=true` PostgreSQL'den taze özet getirir; tabloyu ve Redis telemetrisini de yeniler.
- **Tema problemi:** Yeni `dashboard-v3.js` / `dashboard-v3.css` dosyaları tarayıcıdaki V2 önbellek çakışmasını önler. Varsayılan açık tema, tercihe bağlı koyu tema.
- **Redis:** Cache-aside, key/TTL denetimi, warm-up, namespace reset, 25× benchmark, INFO memory/stats, DBSIZE ve 600 sn TTL ile atomik INCR.
- **Cache invalidation:** Çalışan ekleme/değiştirme/silme sonrası `hrlab:epoch` artırılır; eski employee/summary cache anahtarları TTL sonunda silinir.
- **Hata görünürlüğü:** Başarısız API isteklerinde toast ve ilgili panelde durum bilgisi gösterilir.

## Mevcut V2 Codespaces'te kurulum (önerilir)

1. `RedisHRLab-v3.zip` arşivini Codespaces'te **repo köküne**, `Dockerfile` ile aynı klasöre yükleyin.
2. Terminalde:

```bash
unzip -o RedisHRLab-v3.zip -d .
bash scripts/deploy_v3.sh
```

Bu script önce PostgreSQL yedeğini `${HOME}/redis-hr-backups` altına alır, ardından `db/migrations/003_employee_crud.sql` migration'ını çalıştırır, .NET API'yi yeniden derler, entegrasyon testlerini çalıştırır ve **testler geçerse** güncel dosyaları GitHub `main` branch'ine commit/push eder. Test geçmezse push yapılmaz. **Asla `docker compose down -v` kullanmayın.**

Dashboard: Codespaces **Bağlantı Noktaları → 5080 → İletilen Adres** (görünürlük *Private*).

## Yeni kurulum

```bash
docker compose up --build -d
# db/init.sql, yeni DB volume üzerinde sequence'i de oluşturur.
python3 scripts/smoke_test.py
```

Ağ yapılandırması bu projeye özgü Codespaces ortamındaki üç container'ın ortak network namespace kullandığı geçici geliştirme çözümünü korur; üretim için önerilmez.

## Temel API

| Metot | Endpoint | İşlev |
|---|---|---|
| GET | `/api/status` | PostgreSQL/Redis sağlık ve uygulama HIT/MISS |
| GET | `/api/summary?fresh=true` | Taze departman/maaş özeti |
| GET | `/api/employees?page=1&pageSize=12` | Personel filtreleme ve liste |
| GET | `/api/employees/42` | Redis cache-aside tekil çalışan |
| POST | `/api/employees` | Yeni çalışan (JSON `EmployeeInput`) |
| PUT | `/api/employees/{id}` | Çalışanın tüm alanlarını güncelle |
| DELETE | `/api/employees/{id}` | Demo çalışanını sil |
| PATCH | `/api/employees/{id}/salary` | Eski V2 maaş endpoint'i (geriye uyumlu) |
| GET | `/api/redis/stats` | Redis INFO ve DBSIZE |
| GET | `/api/cache/inspect/42` | Cache anahtarı / TTL / byte |
| POST | `/api/cache/warmup?count=100` | 100 / 1000 / 10000 çalışanı Redis'e yükle |
| POST | `/api/cache/reset` | Namespace cache versiyonunu artır |
| GET | `/api/benchmark/42?runs=25` | PostgreSQL vs Redis gecikme testi |
| GET | `/api/redis/counter` | INCR sayaç ve TTL |
| POST | `/api/redis/counter/increment` | Atomik artırma |

### Örnek çalışan ekleme

```bash
curl -i -X POST http://localhost:5080/api/employees \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Ece","lastName":"Demo","age":28,"gender":"Kadın","department":"Yazılım","position":"Yazılım Mühendisi","salary":85000,"startDate":"2025-09-01"}'
```

### Smoke test

```bash
python3 scripts/smoke_test.py
```

Test, tek bir **sentetik test kişisi** ekler, bütün alanlarını günceller ve sonunda siler; mevcut gerçek uygulama kayıtlarını değiştirmez. Redis INCR sayaç test nedeniyle 1 artar. Testlerin başarısı Codespaces'teki çalışma çıktısıyla doğrulanmalıdır; kaynak kodun statik kontrolleri canlı testin yerini tutmaz.

## Veri koruma ve operasyon

- Mevcut PostgreSQL volume korunur. `db/init.sql` yalnızca yeni/boş volume oluşturulurken çalışır.
- V3 migration otomatik ID sequence ekler; **mevcut ID, isim, maaş, yaş, cinsiyet, departman değerlerini değiştirmez**.
- V2'de düzeltilmiş sentetik isimler olduğu gibi kalır.
- Kaydedilen çalışan verileri PostgreSQL'dedir. Redis değerleri geçici cache'tir; Redis'te kalıcı personel kaynağı tutulmaz.
- `REDIS` istatistikleri uygulama HIT/MISS sayaçlarından farklıdır; sistemin kendi `keyspace_hits` ölçümünü içerir.
- `256 MB allkeys-lru` yapılandırması demo ayarıdır. Production için yetkilendirme, TLS, secret yönetimi, güvenli veri modeli, audit trail, outbox/cache invalidation ve ölçeklendirme gereklidir.

## Dosya düzeni

```text
src/RedisLab.Api/Program.cs                     API + Redis V2 uyumlu endpoint'ler
src/RedisLab.Api/HrManagementEndpoints.cs        Yeni POST/PUT/DELETE REST işlemleri
src/RedisLab.Api/wwwroot/index.html              V3 dashboard
src/RedisLab.Api/wwwroot/dashboard-v3.js         Çalışan formu ve tüm buton davranışları
src/RedisLab.Api/wwwroot/dashboard-v3.css        Açık/koyu tema
scripts/deploy_v3.sh                             Yedek + migration + build + test + push
scripts/smoke_test.py                            Redis ve CRUD entegrasyon testi
db/migrations/003_employee_crud.sql              Mevcut DB'ye sequence
```

## Doğrulama notu — V3

- Yeni arayüz için Chromium/Playwright ile sahte API yanıtları kullanılarak **açık/koyu tema, yenileme, çalışan ekleme/düzenleme/silme formu, Redis metrikleri, TTL, INCR, warm-up, reset, benchmark ve filtreleme** davranışları kontrol edildi; JavaScript hata olayı görülmedi.
- HTML form ve buton ID'leri JavaScript ile eşleştirildi; JavaScript (`node --check`), Python ve Bash sözdizimi kontrol edildi.
- Bu testler **gerçek .NET API'nin derlenmesi veya canlı PostgreSQL/Redis CRUD testi değildir**. Bunlar yalnızca Codespaces'te `scripts/deploy_v3.sh` aracılığıyla yapılır. Scriptin otomatik GitHub push'u sadece `scripts/smoke_test.py` başarılı olursa yapılır.
- Smoke test, test amaçlı yeni kayıt ekleyip günceller ve sonrasında siler; `INCR` sayacı ise 1 artar.
- ZIP dosyasının kendisi commit'e eklenmez.
