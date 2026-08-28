# Dixora

Dixora is a multi-tenant restaurant and hospitality operations platform. This
repository contains a complete local showcase and reference implementation for
business administration, waiter and cashier operations, kitchen routing, QR
menus, inventory, reporting, audit, subscriptions, and local printing.

The web, API, migrations, seed, tests, and Docker topology run as one system.
Production certification still depends on the deployment-specific controls and
external hardware integrations listed under **Current limitations**.

## Architecture at a glance

- **Web:** Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, TanStack
  Query, React Hook Form, Zod
- **API:** FastAPI, SQLAlchemy 2, Alembic, Pydantic, PostgreSQL
- **Coordination:** Redis is provisioned for distributed fan-out and cache-ready
  concerns; security-critical state remains persisted
- **Media:** S3-compatible abstraction with MinIO locally
- **Real time:** WebSocket-ready API; important state remains persisted
- **Printing:** Persisted print jobs and a TypeScript local bridge with a mock
  adapter
- **Structure:** One modular backend deployable and explicit business-domain
  boundaries

Every tenant-owned record carries `tenant_id`; branch-specific operational data
also carries `branch_id`. Tenant scope comes from authenticated server context,
never from a tenant ID submitted by the browser.

## Repository

```text
apps/
  api/            FastAPI modular monolith
  web/            Next.js application
  print-bridge/   Local bridge protocol and mock printer
packages/
  config/         Shared TypeScript configuration
  shared-types/   Wire and operational contracts
  ui/             Small reusable presentation primitives
infrastructure/
  docker/         Local image and database initialization assets
docs/             Architecture and domain documentation
docker-compose.yml
Makefile
```

## Requirements

- Docker Engine and Docker Compose
- Node.js 22+ and npm 11 for host-side frontend/package development
- Python 3.11+ only when running the API outside Docker
- GNU Make is optional

Windows developers can use the documented Docker/npm commands directly; GNU
Make is not included with PowerShell by default.

## Quick start

1. Create local environment configuration:

   PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

   POSIX shell:

   ```bash
   cp .env.example .env
   ```

2. Install JavaScript workspace dependencies:

   ```bash
   npm install
   ```

3. Validate and start the stack:

   ```bash
   docker compose config --quiet
   docker compose up --build
   ```

4. In another terminal, apply migrations and seed development data:

   ```bash
   docker compose run --rm api alembic upgrade head
   docker compose run --rm api dixora-seed
docker compose run --rm api python -m app.demo --reset
   ```

5. Open:

   - Web: <http://localhost:3000>
   - API: <http://localhost:8000>
   - OpenAPI: <http://localhost:8000/api/v1/docs>
   - MinIO console: <http://localhost:9001>
   - Mock Print Bridge health: <http://localhost:9100/healthz>

Compose starts PostgreSQL, Redis, MinIO, the API, web application, and mock Print
Bridge with health dependencies. Startup applies Alembic migrations before
Uvicorn serves traffic.

## Development seed accounts

These credentials are only for the local development seed. They are intentionally
public and must never be enabled or reused in staging or production.

Business: `dixora-lab`  
Branch: `merkez`

| Role               | Login                   | Development password / PIN    |
| ------------------ | ----------------------- | ----------------------------- |
| Dixora Super Admin | `superadmin@dixora.app` | `Dixora!2026`                 |
| İşletme Sahibi     | `owner@dixora.test`     | `DixoraLab!2026`              |
| Şube Yöneticisi    | `manager@dixora.test`   | `DixoraLab!2026`              |
| Kasa Kullanıcısı   | `cashier@dixora.test`   | `DixoraLab!2026` / PIN `1357` |
| Servis Personeli   | `waiter@dixora.test`    | `DixoraLab!2026` / PIN `2468` |
| Kitchen User       | `kitchen@dixora.test`   | `DixoraLab!2026`              |
| Bar User           | `bar@dixora.test`       | `DixoraLab!2026`              |

PIN ile hızlı girişte cihaz önce aynı tarayıcıda başarılı bir işletme parola
girişiyle yetkilendirilir. Yerel seed'i test etmek için:

1. `/login` ekranında işletme `dixora-lab`, kullanıcı
   `owner@dixora.test`, parola `DixoraLab!2026` ile giriş yapın.
2. Oturumu kapatın. Çıkış, şube kapsamlı güvenilir cihaz kaydını silmez.
3. `/login?mode=waiter` ekranında işletme `dixora-lab`, şube `merkez`,
   kullanıcı `waiter@dixora.test`, PIN `2468` ile giriş yapın.

Yeni bir tarayıcı, gizli pencere veya süresi dolmuş/iptal edilmiş cihaz kaydı için
ilk parola yetkilendirmesi tekrar gerekir. Ham cihaz anahtarı yalnız HttpOnly
cookie'de tutulur; API veritabanına SHA-256 özeti yazılır.

## Demo işletme: Meydan Restaurant

`dixora-seed` bir sistemin ayakta olduğunu göstermeye yeter; ürün tanıtımı ve
uçtan uca test için dolu bir işletme gerekir. `app.demo` üç şubeli, 90 günlük
satış geçmişi olan kurgusal bir restoran kurar.

```bash
docker compose exec -T api python -m app.demo --reset
```

`--reset` var olan demo işletmesini tüm verisiyle siler ve sıfırdan kurar; bayrak
verilmezse ve işletme zaten varsa komut hiçbir şeye dokunmadan çıkar. Yalnızca
`meydan-restaurant` kodlu işletme etkilenir, veritabanındaki diğer işletmeler
hiç okunmaz. Kurulum yaklaşık 40 saniye sürer.

| Bayrak            | Etkisi                                                          |
| ----------------- | --------------------------------------------------------------- |
| `--reset`         | Var olan demo işletmesini silip yeniden kurar                    |
| `--days N`        | Üretilecek geçmiş gün sayısı (varsayılan 90)                     |
| `--seed N`        | Rastgelelik tohumu; aynı tohum aynı veriyi üretir                |
| `--force`         | Production ortam kontrolünü atlar                                |

İşletme: `meydan-restaurant` · Şubeler: `kadikoy`, `besiktas`, `bagdat-caddesi`

| Rol             | Login                                | Parola / PIN            |
| --------------- | ------------------------------------ | ----------------------- |
| İşletme Sahibi  | `kemal.meydan@meydanrestaurant.com`  | `Meydan!2026`           |
| Yönetici        | `nurten.aksoy@meydanrestaurant.com`  | `Meydan!2026`           |
| Muhasebe        | `serpil.yildiz@meydanrestaurant.com` | `Meydan!2026`           |
| Şube Müdürü     | `emre.tanriverdi@meydanrestaurant.com` | `Meydan!2026` / PIN `4410` |
| Kasiyer         | `selin.korkmaz@meydanrestaurant.com` | `Meydan!2026` / PIN `1204` |
| Garson          | `deniz.arslan@meydanrestaurant.com`  | `Meydan!2026` / PIN `2301` |
| Mutfak          | `hasan.kilic@meydanrestaurant.com`   | `Meydan!2026`           |

Toplam 27 personel kurulur; şube başına müdür, kasiyer, garson ve istasyon
bazlı mutfak kullanıcıları vardır. Tam liste `apps/api/app/demo/data.py`
içindedir ve tüm hesaplar aynı parolayı kullanır.

Kurulumdan çıkan tablo:

- 12 kategori, 83 ürün (fiyat, açıklama, alerjen, kalori, hazırlık süresi),
  7 seçenek grubu, pizza ve kebaplarda porsiyon varyantları
- Şube başına Salon/Teras/Bahçe alanları ve toplam 64 masa
- Şube başına Mutfak, Izgara, Bar, Tatlı istasyonları ve yazıcıları
- 27 stok kalemi, reçeteler, hareket geçmişi ve bilerek eşiğin altında
  bırakılmış birkaç kalem (düşük stok uyarısı boş kalmasın diye)
- ~9.000 sipariş, ~57.000 sipariş satırı, ödemeler, mutfak fişleri, indirimler,
  iptaller ve günlük kasa devirleri
- 50 sadakat üyesi, biriken ziyaretler, kazanılmış ve kullanılmış ödüller
- Getir / Yemeksepeti / Trendyol entegrasyonları ve paket servis kutusunda
  hâlen hareket eden siparişler
- O anki canlı durum: dolu masalar, mutfaktaki fişler, onay bekleyen QR
  sepetleri ve açık kasa devirleri

QR menü şu adreste açılır:
`http://localhost:3000/m/meydan-restaurant/kadikoy`

Print bridge token'ları: `pb_demo_meydan_kadikoy`, `pb_demo_meydan_besiktas`,
`pb_demo_meydan_bagdat-caddesi`.

Bu veri kurgusaldır ve yalnız geliştirme ortamında üretilir; komut production
ortamında `--force` verilmedikçe çalışmayı reddeder.

## Commands

### Complete stack

```bash
docker compose up --build --detach
docker compose ps
docker compose logs --follow --tail=200
docker compose down
```

### Database

```bash
docker compose run --rm api alembic upgrade head
docker compose run --rm api alembic current
docker compose run --rm api dixora-seed
```

### JavaScript workspaces

```bash
npm run dev:web
npm run dev:print-bridge
npm run build
npm run lint
npm run typecheck
npm test
npm run format:check
```

### API checks

```bash
docker compose run --rm api ruff check .
docker compose run --rm api mypy app
docker compose run --rm api pytest
```

If GNU Make is available, `make help` lists equivalent shortcuts. `make check`
runs both JavaScript and API quality gates.

## Çok şubeli işletmeler

Bir işletmenin kataloğu (kategoriler, ürünler, seçenek grupları, kampanyalar,
sadakat programı) işletme genelindedir; hazırlık istasyonları, yazıcılar,
masalar, stok, reçeteler ve adisyonlar şubeye aittir. Bu iki kapsamın kesiştiği
yerlerde geçerli kurallar:

**Şube erişimi.** Şubesi olmayan kullanıcı (sahip, yönetici) tüm şubeleri
kapsar. Bir şubeye bağlı kullanıcı yalnız o şubeyi ve kendisine ayrıca verilmiş
şube üyeliklerini kapsar. Kimlikle gelen her kayıt — adisyon, masa, fiş, kasa
devri, QR isteği, yazıcı, personel, şube — kaydın kendi şubesine erişim
kontrolünden geçer; UUID bilmek erişim değildir. `require_record_branch`
(`app/dependencies.py`) bu kontrolün tek yeridir ve
`tests/test_cross_branch_sweep.py` her `{id}` alan ucu süpürerek yenisinin
unutulmasını engeller.

**Mutfak yönlendirmesi.** `Product.preparation_station_id` tek bir şubenin
istasyonunu gösterebilir, bu yüzden katalog kaydı bir şablon olarak okunur:
sipariş satırı, siparişi alan şubenin aynı koda sahip istasyonuna bağlanır
(`branch_station_map`, `app/services/orders.py`). Aksi hâlde ikinci şubenin
fişleri kendi istasyon filtresinde görünmez ve yazıcı araması boş dönerdi.

**Yeni şube açmak.** `POST /branches` yeni şubeyi boş bırakmaz: hazırlık
istasyonlarını, varsayılan depoyu, stok kalemi tanımlarını ve reçeteleri en eski
aktif şubeden kopyalar (`app/services/branch_setup.py`). Stok miktarları sıfır
başlar ve masa düzeni işletmeye bırakılır. Kopyalanmasaydı yeni şube sipariş
alır ama mutfağa hiçbir fiş düşmez, stok takipli her ürün de `recipe_missing`
ile reddedilirdi.

**Şubeye özel menü.** Kategori `branch_id` alabilir. Böyle bir kategorideki
ürünler yalnız o şubede satılabilir — QR menü bunu zaten uyguluyordu, artık
kasa da uyguluyor. `GET /catalog/products?branch_id=…` aynı daraltmayı yapar;
parametresiz çağrı tüm işletmeyi döndürür, katalog yönetim ekranı bunu kullanır.

**Faturalama.** Plan bir şube içerir, fazlası aylık ek ücretlidir
(`GET /branches/pricing`). Arşivlenen şube faturadan düşer, geçmiş kayıtları
durur.

Bilinen eksik: `product_branch_availability` tablosu şemada var ama hiçbir kod
onu okumuyor veya yazmıyor. "Bu ürün bugün sadece şu şubede yok" hâlâ
ifade edilemiyor; şubeye özel menü bugün yalnız kategori düzeyinde çalışıyor.
Ayrıca raporlar tek şube kapsamındadır; şubeleri yan yana karşılaştıran
birleşik bir görünüm yoktur.

## Environment configuration

`.env.example` documents local configuration for:

- PostgreSQL and SQLAlchemy
- Redis
- MinIO/S3
- API token and session settings
- Browser API URL and CORS
- Development seed
- Mock Print Bridge

Do not commit `.env`. Production secrets belong in a managed secret store.
Production startup must reject placeholder JWT, database, MinIO, seed, and
bridge credentials.

Authentication stays in HttpOnly cookies. `AUTH_COOKIE_SECURE` controls the
HTTPS flag and `AUTH_COOKIE_DOMAIN` may scope cookies to a trusted deployment
domain; keep the domain empty on localhost. A normal login uses browser-session
cookies backed by the short `DIXORA_SESSION_REFRESH_TOKEN_HOURS` policy. “Beni
hatırla” uses the persisted `DIXORA_REFRESH_TOKEN_DAYS` policy, capped on the
web tier by `AUTH_REFRESH_COOKIE_MAX_AGE_SECONDS` when configured.

## Testing expectations

Critical test categories are:

- Authentication, refresh rotation, revocation, and permissions
- Tenant and branch isolation for read/write/reference attempts
- Multi-branch station routing, branch provisioning, and branch-scoped menus
- Order state, item snapshots, idempotency, table transfer, and payments
- QR session, duplicate submission, and staff approval
- Decimal inventory deduction and reversal
- Paid-order loyalty accrual, reward redemption, and append-only reversal
- Kitchen routing and print job idempotency

Tenant isolation is a release blocker. A Tenant A user must be unable to list,
read, update, delete, reference, subscribe to, export, or print Tenant B
resources even when they know a valid UUID.

Branch isolation is the same rule one level down and is swept the same way: a
user scoped to Branch A must not reach Branch B's records inside the same
business. `tests/test_cross_branch_sweep.py` walks every id-bearing route, so an
endpoint added later that filters on `tenant_id` alone fails the suite.

## Documentation

- [Implementation plan](docs/implementation-plan.md)
- [Architecture](docs/architecture.md)
- [Architecture decisions](docs/architecture-decisions.md)
- [Database](docs/database.md)
- [Authentication](docs/authentication.md)
- [Multi-tenancy](docs/multi-tenancy.md)
- [Order lifecycle](docs/order-lifecycle.md)
- [QR ordering](docs/qr-ordering.md)
- [Inventory](docs/inventory.md)
- [Product media](docs/media.md)
- [Printing](docs/printing.md)
- [Loyalty MVP](docs/loyalty-mvp.md)
- [Local development](docs/local-development.md)
- [Future roadmap](docs/future-roadmap.md)

## Current limitations

- Browser-level acceptance against every supported printer, tablet, and network
  topology remains deployment work; automated API and component coverage is
  included in the repository.
- PostgreSQL Row-Level Security is designed but must not be considered active
  until transaction-local context and pool-isolation tests pass.
- The real-time layer requires persisted outbox dispatch and reconnect
  integration tests before production use.
- Login throttling is persistent and QR ordering has server-side pending-request
  quotas. Before an internet-facing deployment, the reverse proxy must provide a
  trusted client-IP boundary and an edge/distributed limiter; otherwise the BFF
  collapses callers to one backend network address.
- Product media upload validation and private-bucket delivery are implemented.
  Responsive variants, thumbnails, malware scanning, and CDN deployment remain
  production integration work.
- Print Bridge uses a scoped bridge token and persisted server-side jobs, but its
  bundled printer transport is a mock. Physical printer drivers, durable local
  disk spooling, enrollment rotation, and device-specific acceptance remain
  deployment work.
- Online payments, fiscal cash registers, accounting, delivery, reservations,
  hotel room charges, and subscription billing are not implemented. Loyalty is
  available as an MVP; its Netgsm OTP adapter requires a customer-owned Netgsm
  account, OTP package, approved message header and production secrets. Production
  launch also requires bot protection, atomic provider/spend quotas and one-time
  OTP consumption. Same-order reward reservation is intentionally disabled.
- Trusted PIN devices are tenant/branch scoped and revocation-ready. A management
  screen for listing/revoking devices and explicit multi-branch terminal
  enrollment remain release work.
- Docker Compose is for local development. Production infrastructure, backups,
  observability, incident response, compliance, and restore drills remain
  release work.
- Code-native light/dark SVG marks, PWA icons, and the supplied raster originals
  are included. A final trademark/brand review is still recommended before a
  public launch.

Dependency findings are reviewed rather than force-fixed. Run `npm audit` and
upgrade affected framework/transitive packages through tested releases; never
accept an automated breaking downgrade as a security fix.

## Security reporting

Do not open a public issue containing credentials, customer data, or a suspected
tenant-isolation exploit. Until a private security channel is established,
contact the repository owner directly and provide the smallest safe
reproduction.
