# Redis HR Lab · ASP.NET Core 10 + PostgreSQL + Redis 8

**Tamamen sentetik 10.000 çalışan profili** üzerinde departman, yaş, cinsiyet ve brüt maaş analizi yapan; PostgreSQL sorgularını Redis cache ile karşılaştıran eğitim projesi. Gerçek kişi veya bordro verisi kullanılmaz.

## Başlatma

Gerekenler: Docker Desktop (veya Docker Engine + Compose). Proje klasöründe:

```bash
docker compose up --build -d
docker compose ps
```

**Web arayüzü:** http://localhost:5080

GitHub Codespaces kullanıyorsanız **Ports** sekmesinden 5080 portunu açıp görünürlüğünü **private** tutun. Docker imajlarını ve NuGet paketlerini çekmek için internet gerekir.

## Neler var?

- 10.000 sentetik çalışan (8 departman, unvan, cinsiyet, yaş, maaş, işe giriş tarihi).
- Çalışan tablosunda arama, departman ve cinsiyet filtreleri, sayfalama.
- Brüt maaş güncelleme, PostgreSQL kalıcı saklama ve ilgili Redis anahtarlarının silinmesi.
- Redis cache-aside: ilk sorgu **MISS/PostgreSQL**, ikinci sorgu **HIT/Redis**; TTL 300 sn.
- İstatistik özeti: çalışan sayısı, ortalama maaş, aylık toplam, ortalama yaş, departman ve cinsiyet dağılımı; Redis TTL 60 sn.
- Toplu cache warm-up: 100 / 1.000 / 10.000 kayıt.
- Cache reset: namespace sürüm anahtarı (mevcut veriler TTL sonrası otomatik silinir).
- PostgreSQL/Redis sorgu gecikmesi, ortalama ve p95 karşılaştırması; tek istemcili sentetik benchmark.
- Health/status kartları, hit/miss metrikleri, etkileşim geçmişi.

## API

| Method | Endpoint | Açıklama |
|---|---|---|
| GET | `/api/status` | PostgreSQL/Redis durumu + hit/miss |
| GET | `/api/departments` | Departmanlar |
| GET | `/api/summary` | Analiz özeti, cache-aside |
| GET | `/api/employees?page=1&pageSize=12&department=Network` | Arama ve filtre |
| GET | `/api/employees/42` | Cache-aside tek çalışan |
| PATCH | `/api/employees/42/salary` | `{"salary":90000}` |
| POST | `/api/cache/warmup?count=100` | PostgreSQL → Redis |
| POST | `/api/cache/reset` | Cache namespace sürümü |
| GET | `/api/benchmark/42?runs=25` | Ardışık iki backend ölçümü |

## Test

```bash
python3 scripts/smoke_test.py
```

GitHub Actions'ta `.github/workflows/ci.yml` aynı smoke testini çalıştıracak şekilde tanımlıdır.

## Redis Insight (isteğe bağlı)

```bash
docker compose --profile tools up -d redisinsight
```

http://localhost:5540 → Redis host: `redis`, port: `6379`.

## Sıfırlama / güvenlik

```bash
docker compose down
# Veri hacimleri DAHİL tamamen sıfırlamak için:
docker compose down -v
```

Veri tohumlama script'i **yalnızca boş PostgreSQL veri hacmiyle ilk başlangıçta** çalışır. Bu repodaki varsayılan şifre yalnızca izole test içindir. Uygulamada kullanıcı doğrulaması yoktur, yalnızca yerel veya **private Codespaces** ortamında çalıştırılmalıdır; internete açık hale getirmeyin. Maaş ve cinsiyet gibi alanlar gerçek kişilere ait olsaydı rol tabanlı yetkilendirme, denetim kaydı ve veri koruma gerektirirdi.

**Mimari not:** Çalışan cache invalidation ilgili key'i siler, özet cache de silinir. Bir yazma sırasında Redis erişilemiyorsa kayıt PostgreSQL'e yazılır; Redis tekrar geldiğinde anahtar TTL bitene kadar eski veri döndürebilir. Üretimde transactional outbox / event tabanlı invalidation gibi güvence eklenmelidir. Bu demo, kurumsal Redis Enterprise özelliği gerektirmez.

## GitHub web arayüzüyle tek seferde yükleme

ZIP dosyasını çıkarın. GitHub'da `Emocancell/Redis-DotNet-Lab` → **Add file → Upload files** bölümünü açın. ZIP'i doğrudan yüklemeyin (GitHub açmaz). **Çıkardığınız klasörün içindeki tüm dosya ve klasörleri** seçip GitHub sayfasına sürükleyin; klasör yapısı korunur. Sonra `Commit changes` (veya `Propose changes`) deyin. Bu projede 15 kaynak dosyası bulunur.

## GitHub'a kendi oturumunuzla gönderme

ZIP'i çıkarın; Windows'ta Git kurulu ve GitHub'a giriş yapılmışken PowerShell'de proje klasörünü açıp:

```powershell
.\publish-to-github.ps1
```

Script `Emocancell/Redis-DotNet-Lab` repository'sini geçici klasöre klonlar, proje dosyalarını kopyalar, commit ve push yapar. GitHub hesabınıza erişim yalnızca kendi Git oturumunuz üzerinden kullanılır. Repo'da başka önemli dosyalar bulunuyorsa değişiklikleri kontrol edin.

## Test ve doğrulama

`python3 scripts/smoke_test.py` gerçek çalışır ortamda PostgreSQL'in 10.000 kayıtla başlamasını, Redis HIT/MISS, güncelleme sonrası cache temizliği, warm-up ve benchmark endpoint'ini kontrol eder. GitHub Actions da Docker Compose ile bu testi çalıştırmak için yapılandırılmıştır. Kaynak kodun statik kontrolleri yapılsa da hazırlandığı ortamda Docker ve .NET SDK bulunmadığından gerçek runtime smoke testinin başarılı olduğu iddia edilmez.
