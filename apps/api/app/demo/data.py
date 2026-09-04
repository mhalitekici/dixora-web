"""Static description of the Meydan Restaurant demo business.

Kept apart from the builder so the shape of the demo — menu, roster, floor plan —
can be reviewed and edited without reading a line of seeding logic. Every price
is in TRY and every name is written the way it would appear on a real ticket,
because this data is what shows up in screenshots and sales demos.
"""

from __future__ import annotations

from dataclasses import dataclass

TENANT_NAME = "Meydan Restaurant"
TENANT_SLUG = "meydan-restaurant"
TENANT_BUSINESS_TYPE = "RESTAURANT"
EMAIL_DOMAIN = "meydanrestaurant.com"

# One password for every demo login. Ten characters is the API minimum.
DEMO_PASSWORD = "Meydan!2026"
PRINT_BRIDGE_TOKEN_PREFIX = "pb_demo_meydan"

LOYALTY_PROGRAM_NAME = "Meydan Sadakat"
LOYALTY_VISIT_THRESHOLD = 10

DEFAULT_HISTORY_DAYS = 90


@dataclass(frozen=True)
class BranchSpec:
    slug: str
    name: str
    address: str
    phone: str
    # (area name, table name prefix, table count)
    areas: tuple[tuple[str, str, int], ...]
    # Average paid orders on a normal weekday; weekends scale up in the builder.
    weekday_orders: int
    qr_order_mode: str
    marketplaces: tuple[str, ...]


BRANCHES: tuple[BranchSpec, ...] = (
    BranchSpec(
        slug="kadikoy",
        name="Kadıköy (Merkez)",
        address="Caferağa Mah. Moda Cad. No:112, Kadıköy / İstanbul",
        phone="0216 330 14 20",
        areas=(("Salon", "S", 14), ("Teras", "T", 8), ("Bahçe", "B", 6)),
        weekday_orders=46,
        qr_order_mode="WAITER_APPROVAL",
        marketplaces=("GETIR", "YEMEKSEPETI", "TRENDYOL"),
    ),
    BranchSpec(
        slug="besiktas",
        name="Beşiktaş",
        address="Sinanpaşa Mah. Ortabahçe Cad. No:28, Beşiktaş / İstanbul",
        phone="0212 261 08 55",
        areas=(("Salon", "S", 12), ("Teras", "T", 6)),
        weekday_orders=31,
        qr_order_mode="AUTOMATIC_ACCEPTANCE",
        marketplaces=("GETIR", "YEMEKSEPETI"),
    ),
    BranchSpec(
        slug="bagdat-caddesi",
        name="Bağdat Caddesi",
        address="Şaşkınbakkal Mah. Bağdat Cad. No:401, Kadıköy / İstanbul",
        phone="0216 358 77 90",
        areas=(("Salon", "S", 10), ("Bahçe", "B", 8)),
        weekday_orders=24,
        qr_order_mode="AUTOMATIC_ACCEPTANCE",
        marketplaces=("GETIR", "YEMEKSEPETI"),
    ),
)

WORKING_HOURS: dict[str, dict[str, object]] = {
    day: {"is_closed": False, "opens_at": "09:00", "closes_at": "23:59"}
    for day in (
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    )
}

# (name, code) — created once per branch.
STATIONS: tuple[tuple[str, str], ...] = (
    ("Mutfak", "KITCHEN"),
    ("Izgara", "GRILL"),
    ("Bar", "BAR"),
    ("Tatlı", "DESSERT"),
)


@dataclass(frozen=True)
class StaffSpec:
    local_part: str
    display_name: str
    role: str
    pin: str | None = None
    station: str | None = None
    phone: str | None = None


# Business-wide staff: no branch pin, so they see every branch.
HQ_STAFF: tuple[StaffSpec, ...] = (
    StaffSpec("kemal.meydan", "Kemal Meydan", "BUSINESS_OWNER", phone="0532 415 60 11"),
    StaffSpec("nurten.aksoy", "Nurten Aksoy", "BUSINESS_ADMIN", phone="0533 208 44 76"),
    StaffSpec("serpil.yildiz", "Serpil Yıldız", "ACCOUNTANT", phone="0537 611 92 03"),
)

# Per-branch roster. Every local part below is distinct, so the resulting
# usernames stay unique inside the tenant without any suffixing.
BRANCH_STAFF: dict[str, tuple[StaffSpec, ...]] = {
    "kadikoy": (
        StaffSpec("emre.tanriverdi", "Emre Tanrıverdi", "BUSINESS_MANAGER", pin="4410"),
        StaffSpec("selin.korkmaz", "Selin Korkmaz", "CASHIER", pin="1204"),
        StaffSpec("burak.demirel", "Burak Demirel", "CASHIER", pin="1205"),
        StaffSpec("deniz.arslan", "Deniz Arslan", "WAITER", pin="2301"),
        StaffSpec("ceren.polat", "Ceren Polat", "WAITER", pin="2302"),
        StaffSpec("okan.yavuz", "Okan Yavuz", "WAITER", pin="2303"),
        StaffSpec("hasan.kilic", "Hasan Kılıç", "KITCHEN", station="KITCHEN"),
        StaffSpec("murat.sen", "Murat Şen", "KITCHEN", station="GRILL"),
        StaffSpec("elif.gunes", "Elif Güneş", "KITCHEN", station="BAR"),
    ),
    "besiktas": (
        StaffSpec("gizem.ozturk", "Gizem Öztürk", "BUSINESS_MANAGER", pin="4420"),
        StaffSpec("kaan.erdogan", "Kaan Erdoğan", "CASHIER", pin="1214"),
        StaffSpec("melis.aydin", "Melis Aydın", "WAITER", pin="2311"),
        StaffSpec("tolga.ates", "Tolga Ateş", "WAITER", pin="2312"),
        StaffSpec("yasemin.can", "Yasemin Can", "WAITER", pin="2313"),
        StaffSpec("ibrahim.sahin", "İbrahim Şahin", "KITCHEN", station="KITCHEN"),
        StaffSpec("fatih.dogan", "Fatih Doğan", "KITCHEN", station="GRILL"),
        StaffSpec("aylin.kaya", "Aylin Kaya", "KITCHEN", station="BAR"),
    ),
    "bagdat-caddesi": (
        StaffSpec("berk.unal", "Berk Ünal", "BUSINESS_MANAGER", pin="4430"),
        StaffSpec("sema.turan", "Sema Turan", "CASHIER", pin="1224"),
        StaffSpec("arda.celik", "Arda Çelik", "WAITER", pin="2321"),
        StaffSpec("pinar.acar", "Pınar Acar", "WAITER", pin="2322"),
        StaffSpec("volkan.kurt", "Volkan Kurt", "KITCHEN", station="KITCHEN"),
        StaffSpec("nihat.bulut", "Nihat Bulut", "KITCHEN", station="GRILL"),
        StaffSpec("dilara.sonmez", "Dilara Sönmez", "KITCHEN", station="BAR"),
    ),
}

CATEGORIES: tuple[tuple[str, str], ...] = (
    ("Kahvaltı", "#F59E0B"),
    ("Başlangıçlar", "#EC5A20"),
    ("Çorbalar", "#D97706"),
    ("Salatalar", "#16A34A"),
    ("Izgara & Ana Yemekler", "#B91C1C"),
    ("Deniz Ürünleri", "#0EA5E9"),
    ("Makarna & Risotto", "#CA8A04"),
    ("Burger & Sandviç", "#7C2D12"),
    ("Pizzalar", "#DC2626"),
    ("Tatlılar", "#DB2777"),
    ("Sıcak İçecekler", "#78350F"),
    ("Soğuk İçecekler", "#2563EB"),
)


@dataclass(frozen=True)
class ProductSpec:
    name: str
    category: str
    station: str
    price: str
    prep_minutes: int
    # Relative sales weight used when generating historical orders.
    popularity: int
    description: str
    tax_rate: str = "10.00"
    allergens: tuple[str, ...] = ()
    calories: int | None = None
    tags: tuple[str, ...] = ()
    tracked: bool = False


def _p(
    name: str,
    category: str,
    station: str,
    price: str,
    prep: int,
    popularity: int,
    description: str,
    **kwargs: object,
) -> ProductSpec:
    return ProductSpec(
        name=name,
        category=category,
        station=station,
        price=price,
        prep_minutes=prep,
        popularity=popularity,
        description=description,
        **kwargs,  # type: ignore[arg-type]
    )


PRODUCTS: tuple[ProductSpec, ...] = (
    # --- Kahvaltı -------------------------------------------------------
    _p("Serpme Kahvaltı (2 Kişilik)", "Kahvaltı", "KITCHEN", "985.00", 20, 6,
       "Yirmi çeşit kahvaltılık, sıcak ekmek sepeti ve sınırsız çay ile.",
       allergens=("gluten", "süt", "yumurta"), calories=1450, tags=("paylaşımlık",)),
    _p("Kahvaltı Tabağı", "Kahvaltı", "KITCHEN", "425.00", 12, 9,
       "Beyaz peynir, kaşar, zeytin, domates, salatalık, bal-kaymak ve haşlanmış yumurta.",
       allergens=("süt", "yumurta"), calories=760),
    _p("Menemen", "Kahvaltı", "KITCHEN", "265.00", 12, 11,
       "Tereyağında domates ve yeşil biber, kırılmış yumurta ile bakır sahanda.",
       allergens=("yumurta", "süt"), calories=420, tags=("vejetaryen",)),
    _p("Sucuklu Yumurta", "Kahvaltı", "KITCHEN", "285.00", 10, 8,
       "Fermente dana sucuk ve iki yumurta, sahanda.",
       allergens=("yumurta",), calories=520),
    _p("Omlet", "Kahvaltı", "KITCHEN", "235.00", 8, 6,
       "Üç yumurta, kaşar peyniri ve mevsim yeşillikleri.",
       allergens=("yumurta", "süt"), calories=380, tags=("vejetaryen",)),
    _p("Simit & Peynir Tabağı", "Kahvaltı", "KITCHEN", "195.00", 5, 5,
       "Fırından yeni çıkmış susamlı simit, üç çeşit peynir ve reçel.",
       allergens=("gluten", "süt", "susam"), calories=540, tags=("vejetaryen",)),

    # --- Başlangıçlar ---------------------------------------------------
    _p("Humus", "Başlangıçlar", "KITCHEN", "185.00", 5, 10,
       "Tahinli nohut ezmesi, kimyon yağı ve közlenmiş biber ile.",
       allergens=("susam",), calories=310, tags=("vegan",)),
    _p("Haydari", "Başlangıçlar", "KITCHEN", "165.00", 5, 9,
       "Süzme yoğurt, sarımsak ve taze nane.",
       allergens=("süt",), calories=240, tags=("vejetaryen",)),
    _p("Acılı Ezme", "Başlangıçlar", "KITCHEN", "165.00", 5, 11,
       "İnce doğranmış domates, biber, ceviz ve nar ekşisi.",
       allergens=("fındık",), calories=190, tags=("vegan", "acı")),
    _p("Atom Meze", "Başlangıçlar", "KITCHEN", "195.00", 5, 6,
       "Yoğurt, kurutulmuş acı biber ve tereyağı.",
       allergens=("süt",), calories=280, tags=("acı",)),
    _p("Sigara Böreği (6 Adet)", "Başlangıçlar", "KITCHEN", "210.00", 12, 12,
       "El açması yufka içinde beyaz peynir ve maydanoz.",
       allergens=("gluten", "süt"), calories=460, tags=("vejetaryen",)),
    _p("Paçanga Böreği", "Başlangıçlar", "KITCHEN", "245.00", 14, 7,
       "Pastırma, kaşar ve közlenmiş biberle harmanlanmış yufka.",
       allergens=("gluten", "süt"), calories=520),
    _p("Kalamar Tava", "Başlangıçlar", "GRILL", "385.00", 15, 8,
       "Çıtır kalamar halkaları, tartar sos ve limon ile.",
       allergens=("gluten", "deniz ürünleri", "yumurta"), calories=590),
    _p("Zeytinyağlı Enginar", "Başlangıçlar", "KITCHEN", "225.00", 8, 4,
       "Bezelye ve havuçlu enginar, dereotu ile.",
       calories=210, tags=("vegan",)),

    # --- Çorbalar -------------------------------------------------------
    _p("Mercimek Çorbası", "Çorbalar", "KITCHEN", "145.00", 5, 14,
       "Kırmızı mercimek, tereyağı ve limon ile.",
       allergens=("süt",), calories=220, tags=("vejetaryen",)),
    _p("Ezogelin Çorbası", "Çorbalar", "KITCHEN", "145.00", 5, 9,
       "Bulgur, mercimek ve nane-pul biber yağı.",
       calories=240, tags=("vegan",)),
    _p("Domates Çorbası", "Çorbalar", "KITCHEN", "155.00", 5, 7,
       "Közlenmiş domates, kaşar rendesi ve kruton.",
       allergens=("süt", "gluten"), calories=260, tags=("vejetaryen",)),
    _p("Yayla Çorbası", "Çorbalar", "KITCHEN", "155.00", 5, 6,
       "Yoğurtlu pirinç çorbası, nane ile.",
       allergens=("süt",), calories=230, tags=("vejetaryen",)),
    _p("İşkembe Çorbası", "Çorbalar", "KITCHEN", "195.00", 6, 4,
       "Sarımsaklı sirke ve pul biber ile servis edilir.",
       allergens=("süt",), calories=300),

    # --- Salatalar ------------------------------------------------------
    _p("Sezar Salata", "Salatalar", "KITCHEN", "295.00", 10, 11,
       "Marul, ızgara tavuk, parmesan, kruton ve sezar sos.",
       allergens=("gluten", "süt", "yumurta"), calories=480),
    _p("Akdeniz Salatası", "Salatalar", "KITCHEN", "265.00", 8, 7,
       "Beyaz peynir, zeytin, kırmızı soğan ve zeytinyağı.",
       allergens=("süt",), calories=340, tags=("vejetaryen",)),
    _p("Gavurdağı Salatası", "Salatalar", "KITCHEN", "225.00", 8, 9,
       "İri doğranmış domates, ceviz ve nar ekşisi.",
       allergens=("fındık",), calories=260, tags=("vegan",)),
    _p("Ton Balıklı Salata", "Salatalar", "KITCHEN", "315.00", 8, 5,
       "Ton balığı, mısır, kapari ve mevsim yeşillikleri.",
       allergens=("balık",), calories=390),
    _p("Roka Salatası", "Salatalar", "KITCHEN", "195.00", 6, 6,
       "Roka, cherry domates ve parmesan.",
       allergens=("süt",), calories=180, tags=("vejetaryen",)),

    # --- Izgara & Ana Yemekler -----------------------------------------
    _p("Adana Kebap", "Izgara & Ana Yemekler", "GRILL", "545.00", 22, 20,
       "Zırhla çekilmiş kuzu eti, közlenmiş domates-biber ve lavaş ile.",
       allergens=("gluten",), calories=780, tags=("acı", "şef önerisi"), tracked=True),
    _p("Urfa Kebap", "Izgara & Ana Yemekler", "GRILL", "545.00", 22, 12,
       "Acısız kuzu kebabı, közlenmiş sebzeler ve pilav ile.",
       allergens=("gluten",), calories=760, tracked=True),
    _p("Kuzu Şiş", "Izgara & Ana Yemekler", "GRILL", "685.00", 24, 13,
       "Marine edilmiş kuzu külbastı, bulgur pilavı ve közlenmiş sebze.",
       calories=820, tracked=True),
    _p("Tavuk Şiş", "Izgara & Ana Yemekler", "GRILL", "445.00", 20, 16,
       "Yoğurtlu marinasyonda tavuk göğsü, pilav ve közlenmiş sebze.",
       allergens=("süt",), calories=610, tracked=True),
    _p("Karışık Izgara", "Izgara & Ana Yemekler", "GRILL", "795.00", 28, 10,
       "Adana, kuzu şiş, tavuk şiş ve köfteden oluşan tabak.",
       allergens=("gluten",), calories=1180, tags=("paylaşımlık",), tracked=True),
    _p("Kuzu Pirzola", "Izgara & Ana Yemekler", "GRILL", "845.00", 26, 8,
       "Beş parça süt kuzu pirzola, kekikli tereyağı ile.",
       allergens=("süt",), calories=890, tracked=True),
    _p("Beyti Sarma", "Izgara & Ana Yemekler", "GRILL", "625.00", 25, 9,
       "Lavaşa sarılmış kebap, domates sos ve yoğurt ile.",
       allergens=("gluten", "süt"), calories=940),
    _p("İskender", "Izgara & Ana Yemekler", "GRILL", "595.00", 20, 14,
       "Döner, tereyağlı domates sos, yoğurt ve pide.",
       allergens=("gluten", "süt"), calories=980),
    _p("Kuzu Tandır", "Izgara & Ana Yemekler", "KITCHEN", "715.00", 15, 7,
       "Sekiz saat pişmiş kuzu incik, közlenmiş patlıcan püresi üzerinde.",
       allergens=("süt",), calories=870, tags=("şef önerisi",)),
    _p("Izgara Köfte", "Izgara & Ana Yemekler", "GRILL", "465.00", 18, 15,
       "Dana köfte, patates kızartması ve közlenmiş biber.",
       allergens=("gluten",), calories=720, tracked=True),
    _p("Tavuk Kanat", "Izgara & Ana Yemekler", "GRILL", "385.00", 18, 10,
       "Marine edilmiş sekiz adet kanat, acı sos ile.",
       calories=640, tags=("acı",)),
    _p("Etli Güveç", "Izgara & Ana Yemekler", "KITCHEN", "525.00", 15, 6,
       "Kuzu kuşbaşı, mevsim sebzeleri ve kaşar ile fırında.",
       allergens=("süt",), calories=680),

    # --- Deniz Ürünleri -------------------------------------------------
    _p("Levrek Izgara", "Deniz Ürünleri", "GRILL", "685.00", 22, 8,
       "Bütün levrek, roka salatası ve limon ile.",
       allergens=("balık",), calories=520, tracked=True),
    _p("Çipura Izgara", "Deniz Ürünleri", "GRILL", "665.00", 22, 6,
       "Bütün çipura, zeytinyağlı mevsim yeşillikleri ile.",
       allergens=("balık",), calories=500),
    _p("Somon Izgara", "Deniz Ürünleri", "GRILL", "745.00", 20, 9,
       "Norveç somonu, tereyağlı sebze ve limonlu sos.",
       allergens=("balık", "süt"), calories=610, tracked=True),
    _p("Karides Güveç", "Deniz Ürünleri", "KITCHEN", "625.00", 18, 7,
       "Tereyağı, sarımsak ve kaşar ile fırınlanmış karides.",
       allergens=("kabuklu deniz ürünleri", "süt"), calories=540),
    _p("Hamsi Tava", "Deniz Ürünleri", "GRILL", "445.00", 15, 4,
       "Mısır ununa bulanmış hamsi, soğan salatası ile.",
       allergens=("balık",), calories=580),

    # --- Makarna & Risotto ----------------------------------------------
    _p("Penne Arrabiata", "Makarna & Risotto", "KITCHEN", "325.00", 14, 8,
       "Acı domates sos, sarımsak ve fesleğen.",
       allergens=("gluten",), calories=560, tags=("vejetaryen", "acı")),
    _p("Fettuccine Alfredo", "Makarna & Risotto", "KITCHEN", "365.00", 14, 9,
       "Kremalı parmesan sos ve taze karabiber.",
       allergens=("gluten", "süt"), calories=720, tags=("vejetaryen",)),
    _p("Spaghetti Bolognese", "Makarna & Risotto", "KITCHEN", "375.00", 15, 11,
       "Yavaş pişmiş dana ragu ve parmesan.",
       allergens=("gluten", "süt"), calories=690),
    _p("Mantarlı Risotto", "Makarna & Risotto", "KITCHEN", "395.00", 18, 6,
       "Arborio pirinci, karışık mantar ve trüf yağı.",
       allergens=("süt",), calories=640, tags=("vejetaryen",)),
    _p("Deniz Mahsullü Linguine", "Makarna & Risotto", "KITCHEN", "465.00", 18, 5,
       "Karides, midye ve kalamar, beyaz şarap sosu ile.",
       allergens=("gluten", "kabuklu deniz ürünleri"), calories=680),

    # --- Burger & Sandviç ------------------------------------------------
    _p("Meydan Burger", "Burger & Sandviç", "GRILL", "445.00", 16, 18,
       "180 gr dana köfte, cheddar, karamelize soğan ve ev yapımı sos.",
       allergens=("gluten", "süt", "yumurta"), calories=880,
       tags=("şef önerisi",), tracked=True),
    _p("Cheeseburger", "Burger & Sandviç", "GRILL", "415.00", 15, 14,
       "150 gr dana köfte, çift cheddar ve turşu.",
       allergens=("gluten", "süt"), calories=820, tracked=True),
    _p("Tavuk Burger", "Burger & Sandviç", "GRILL", "385.00", 15, 10,
       "Çıtır tavuk göğsü, marul ve ranch sos.",
       allergens=("gluten", "yumurta"), calories=760),
    _p("Truffle Burger", "Burger & Sandviç", "GRILL", "525.00", 17, 7,
       "Dana köfte, trüflü mayonez, mantar ve gruyere.",
       allergens=("gluten", "süt", "yumurta"), calories=940),
    _p("Club Sandviç", "Burger & Sandviç", "KITCHEN", "355.00", 12, 8,
       "Tavuk, bacon, domates ve patates kızartması ile.",
       allergens=("gluten", "yumurta"), calories=790),

    # --- Pizzalar --------------------------------------------------------
    _p("Margherita", "Pizzalar", "KITCHEN", "345.00", 16, 10,
       "San Marzano domates sos, mozzarella ve fesleğen.",
       allergens=("gluten", "süt"), calories=760, tags=("vejetaryen",)),
    _p("Sucuklu Pizza", "Pizzalar", "KITCHEN", "395.00", 16, 12,
       "Fermente sucuk, mozzarella ve közlenmiş biber.",
       allergens=("gluten", "süt"), calories=880),
    _p("Karışık Pizza", "Pizzalar", "KITCHEN", "425.00", 17, 9,
       "Sucuk, salam, mantar, biber ve mısır.",
       allergens=("gluten", "süt"), calories=910),
    _p("Dört Peynirli", "Pizzalar", "KITCHEN", "425.00", 16, 7,
       "Mozzarella, gorgonzola, parmesan ve keçi peyniri.",
       allergens=("gluten", "süt"), calories=940, tags=("vejetaryen",)),
    _p("Ton Balıklı Pizza", "Pizzalar", "KITCHEN", "415.00", 16, 5,
       "Ton balığı, kırmızı soğan ve kapari.",
       allergens=("gluten", "süt", "balık"), calories=820),

    # --- Tatlılar --------------------------------------------------------
    _p("San Sebastian Cheesecake", "Tatlılar", "DESSERT", "265.00", 5, 16,
       "Yanık yüzeyli, akışkan dokulu İspanyol cheesecake.",
       allergens=("süt", "yumurta", "gluten"), calories=520, tags=("şef önerisi",)),
    _p("Künefe", "Tatlılar", "DESSERT", "285.00", 14, 13,
       "Hatay peyniri, kadayıf ve Antep fıstığı.",
       allergens=("süt", "gluten", "fındık"), calories=610),
    _p("Sufle", "Tatlılar", "DESSERT", "245.00", 15, 11,
       "Akışkan çikolatalı sufle, vanilyalı dondurma ile.",
       allergens=("süt", "yumurta", "gluten"), calories=560),
    _p("Tiramisu", "Tatlılar", "DESSERT", "255.00", 5, 9,
       "Mascarpone, espresso ve kakao.",
       allergens=("süt", "yumurta", "gluten"), calories=480),
    _p("Baklava (4 Dilim)", "Tatlılar", "DESSERT", "295.00", 5, 10,
       "Antep fıstıklı, el açması kat kat baklava.",
       allergens=("gluten", "fındık", "süt"), calories=640),
    _p("Sütlaç", "Tatlılar", "DESSERT", "195.00", 5, 7,
       "Fırında pişmiş geleneksel sütlaç.",
       allergens=("süt",), calories=380, tags=("vejetaryen",)),
    _p("Dondurma (3 Top)", "Tatlılar", "DESSERT", "165.00", 3, 8,
       "Vanilya, çikolata ve fıstık.",
       allergens=("süt", "fındık"), calories=340, tags=("vejetaryen",)),

    # --- Sıcak İçecekler -------------------------------------------------
    _p("Türk Kahvesi", "Sıcak İçecekler", "BAR", "125.00", 6, 19,
       "Bakır cezvede pişirilmiş, lokum ile.",
       calories=40, tracked=True),
    _p("Espresso", "Sıcak İçecekler", "BAR", "115.00", 3, 12,
       "Tek shot, özel kavrulmuş çekirdek.",
       calories=10, tracked=True),
    _p("Americano", "Sıcak İçecekler", "BAR", "135.00", 4, 10,
       "Espresso ve sıcak su.", calories=15, tracked=True),
    _p("Latte", "Sıcak İçecekler", "BAR", "165.00", 5, 15,
       "Espresso ve buharla ısıtılmış süt.",
       allergens=("süt",), calories=190, tracked=True),
    _p("Cappuccino", "Sıcak İçecekler", "BAR", "165.00", 5, 13,
       "Espresso, süt ve yoğun süt köpüğü.",
       allergens=("süt",), calories=170, tracked=True),
    _p("Filtre Kahve", "Sıcak İçecekler", "BAR", "145.00", 4, 9,
       "Günün çekirdeği, V60 ile demlenmiş.", calories=15, tracked=True),
    _p("Çay", "Sıcak İçecekler", "BAR", "65.00", 3, 26,
       "Rize çayı, ince belli bardakta.", calories=5),
    _p("Bitki Çayı", "Sıcak İçecekler", "BAR", "95.00", 4, 6,
       "Ihlamur, papatya veya nane-limon.", calories=5, tags=("vegan",)),
    _p("Sıcak Çikolata", "Sıcak İçecekler", "BAR", "175.00", 6, 7,
       "Belçika çikolatası ve süt köpüğü.",
       allergens=("süt",), calories=320),
    _p("Salep", "Sıcak İçecekler", "BAR", "165.00", 6, 5,
       "Gerçek salep ve tarçın.", allergens=("süt",), calories=280),

    # --- Soğuk İçecekler --------------------------------------------------
    _p("Ev Yapımı Limonata", "Soğuk İçecekler", "BAR", "155.00", 4, 17,
       "Taze sıkılmış limon, nane ve az şeker.",
       calories=140, tags=("vegan",), tracked=True),
    _p("Ayran", "Soğuk İçecekler", "BAR", "75.00", 2, 22,
       "Ev yapımı, tuzlu ve köpüklü.",
       allergens=("süt",), calories=90, tracked=True),
    _p("Şalgam", "Soğuk İçecekler", "BAR", "85.00", 2, 8,
       "Acılı veya acısız.", calories=30, tags=("vegan",)),
    _p("Kola", "Soğuk İçecekler", "BAR", "95.00", 1, 20,
       "330 ml kutu.", tax_rate="20.00", calories=140, tracked=True),
    _p("Soda", "Soğuk İçecekler", "BAR", "65.00", 1, 12,
       "Sade veya meyveli.", tax_rate="20.00", calories=5),
    _p("Meyve Suyu", "Soğuk İçecekler", "BAR", "115.00", 2, 9,
       "Şeftali, vişne veya portakal.", calories=120),
    _p("Ice Latte", "Soğuk İçecekler", "BAR", "175.00", 5, 11,
       "Soğuk demleme espresso ve süt, buz üzerine.",
       allergens=("süt",), calories=160, tracked=True),
    _p("Milkshake", "Soğuk İçecekler", "BAR", "205.00", 6, 7,
       "Çilek, çikolata veya muz.",
       allergens=("süt",), calories=420),
    _p("Taze Sıkma Portakal Suyu", "Soğuk İçecekler", "BAR", "185.00", 4, 8,
       "Dört portakaldan, anında sıkılmış.", calories=180, tags=("vegan",)),
    _p("Su", "Soğuk İçecekler", "BAR", "35.00", 1, 30,
       "0,5 lt kaynak suyu.", calories=0),
)


@dataclass(frozen=True)
class ModifierGroupSpec:
    name: str
    is_required: bool
    minimum: int
    maximum: int | None
    # (modifier name, price delta)
    modifiers: tuple[tuple[str, str], ...]
    # Products this group is attached to.
    products: tuple[str, ...]


BURGERS = (
    "Meydan Burger",
    "Cheeseburger",
    "Tavuk Burger",
    "Truffle Burger",
)
MILK_COFFEES = ("Latte", "Cappuccino", "Americano", "Filtre Kahve", "Ice Latte")

MODIFIER_GROUPS: tuple[ModifierGroupSpec, ...] = (
    ModifierGroupSpec(
        "Pişirme Derecesi", True, 1, 1,
        (("Az Pişmiş", "0.00"), ("Orta", "0.00"), ("İyi Pişmiş", "0.00")),
        BURGERS + ("Kuzu Pirzola",),
    ),
    ModifierGroupSpec(
        "Ekstra Malzemeler", False, 0, 4,
        (
            ("Ekstra Cheddar", "45.00"),
            ("Ekstra Köfte", "120.00"),
            ("Bacon", "65.00"),
            ("Karamelize Soğan", "35.00"),
            ("Jalapeño", "30.00"),
            ("Avokado", "75.00"),
        ),
        BURGERS + ("Club Sandviç",),
    ),
    ModifierGroupSpec(
        "Yan Ürün Seçimi", True, 1, 1,
        (
            ("Patates Kızartması", "0.00"),
            ("Soğan Halkası", "45.00"),
            ("Mevsim Salata", "0.00"),
            ("Bulgur Pilavı", "0.00"),
        ),
        BURGERS + ("Club Sandviç", "Izgara Köfte"),
    ),
    ModifierGroupSpec(
        "Sos Seçimi", False, 0, 3,
        (
            ("BBQ Sos", "25.00"),
            ("Ranch Sos", "25.00"),
            ("Acı Sos", "25.00"),
            ("Sarımsaklı Mayonez", "25.00"),
        ),
        BURGERS + ("Tavuk Kanat", "Club Sandviç"),
    ),
    ModifierGroupSpec(
        "Kahve Şekeri", True, 1, 1,
        (("Sade", "0.00"), ("Az Şekerli", "0.00"), ("Orta Şekerli", "0.00"),
         ("Şekerli", "0.00")),
        ("Türk Kahvesi",),
    ),
    ModifierGroupSpec(
        "Süt Tercihi", False, 0, 1,
        (("Laktozsuz Süt", "20.00"), ("Badem Sütü", "35.00"), ("Yulaf Sütü", "35.00")),
        MILK_COFFEES,
    ),
    ModifierGroupSpec(
        "İçecek Boyutu", True, 1, 1,
        (("Küçük", "0.00"), ("Orta", "25.00"), ("Büyük", "45.00")),
        MILK_COFFEES + ("Ev Yapımı Limonata", "Milkshake"),
    ),
)

# product name -> ((variant name, price delta), ...)
PRODUCT_VARIANTS: dict[str, tuple[tuple[str, str], ...]] = {
    "Margherita": (("Orta (26 cm)", "0.00"), ("Büyük (32 cm)", "120.00")),
    "Sucuklu Pizza": (("Orta (26 cm)", "0.00"), ("Büyük (32 cm)", "120.00")),
    "Karışık Pizza": (("Orta (26 cm)", "0.00"), ("Büyük (32 cm)", "120.00")),
    "Dört Peynirli": (("Orta (26 cm)", "0.00"), ("Büyük (32 cm)", "120.00")),
    "Ton Balıklı Pizza": (("Orta (26 cm)", "0.00"), ("Büyük (32 cm)", "120.00")),
    "Adana Kebap": (("1 Porsiyon", "0.00"), ("1,5 Porsiyon", "180.00")),
    "Urfa Kebap": (("1 Porsiyon", "0.00"), ("1,5 Porsiyon", "180.00")),
}


@dataclass(frozen=True)
class InventorySpec:
    name: str
    unit: str
    minimum_stock: str
    opening_quantity: str
    unit_cost: str


INVENTORY: tuple[InventorySpec, ...] = (
    InventorySpec("Dana Kıyma", "gram", "5000", "42000", "0.62"),
    InventorySpec("Kuzu Kuşbaşı", "gram", "4000", "28000", "0.85"),
    InventorySpec("Tavuk Göğsü", "gram", "4000", "31000", "0.34"),
    InventorySpec("Burger Ekmeği", "adet", "30", "180", "14.00"),
    InventorySpec("Domates", "gram", "3000", "26000", "0.08"),
    InventorySpec("Soğan", "gram", "3000", "24000", "0.05"),
    # Deliberately below minimum so the low-stock widget has real content.
    InventorySpec("Kaşar Peyniri", "gram", "2000", "1450", "0.48"),
    InventorySpec("Beyaz Peynir", "gram", "2000", "9500", "0.40"),
    InventorySpec("Cheddar Dilim", "adet", "60", "38", "6.50"),
    InventorySpec("Zeytinyağı", "ml", "3000", "18000", "0.34"),
    InventorySpec("Un", "gram", "5000", "40000", "0.03"),
    InventorySpec("Pirinç", "gram", "4000", "26000", "0.09"),
    InventorySpec("Bulgur", "gram", "3000", "19000", "0.06"),
    InventorySpec("Patates", "gram", "8000", "62000", "0.04"),
    InventorySpec("Yumurta", "adet", "60", "420", "5.20"),
    InventorySpec("Süt", "ml", "10000", "7200", "0.06"),
    InventorySpec("Kahve Çekirdeği", "gram", "2000", "11500", "1.35"),
    InventorySpec("Limon", "adet", "40", "260", "7.50"),
    InventorySpec("Marul", "adet", "20", "110", "22.00"),
    InventorySpec("Levrek", "adet", "10", "34", "165.00"),
    InventorySpec("Somon Fileto", "gram", "3000", "14000", "1.10"),
    InventorySpec("Karides", "gram", "2000", "8500", "1.45"),
    InventorySpec("Tereyağı", "gram", "2000", "12000", "0.72"),
    InventorySpec("Krema", "ml", "3000", "9000", "0.28"),
    InventorySpec("Toz Şeker", "gram", "3000", "22000", "0.04"),
    InventorySpec("Ayran (Şişe)", "adet", "48", "310", "18.00"),
    InventorySpec("Kola (Kutu)", "adet", "48", "26", "26.00"),
)

# product name -> ((inventory item, quantity per portion), ...)
RECIPES: dict[str, tuple[tuple[str, str], ...]] = {
    "Meydan Burger": (
        ("Dana Kıyma", "180"),
        ("Burger Ekmeği", "1"),
        ("Cheddar Dilim", "2"),
        ("Soğan", "40"),
        ("Domates", "30"),
        ("Patates", "150"),
    ),
    "Cheeseburger": (
        ("Dana Kıyma", "150"),
        ("Burger Ekmeği", "1"),
        ("Cheddar Dilim", "2"),
        ("Patates", "150"),
    ),
    "Adana Kebap": (
        ("Dana Kıyma", "200"),
        ("Domates", "80"),
        ("Soğan", "50"),
        ("Bulgur", "90"),
    ),
    "Tavuk Şiş": (
        ("Tavuk Göğsü", "220"),
        ("Pirinç", "90"),
        ("Domates", "60"),
    ),
    "Izgara Köfte": (
        ("Dana Kıyma", "170"),
        ("Soğan", "35"),
        ("Patates", "150"),
    ),
    "Levrek Izgara": (("Levrek", "1"), ("Limon", "1"), ("Zeytinyağı", "20")),
    "Somon Izgara": (("Somon Fileto", "220"), ("Tereyağı", "25"), ("Limon", "1")),
    "Latte": (("Kahve Çekirdeği", "18"), ("Süt", "220")),
    "Cappuccino": (("Kahve Çekirdeği", "18"), ("Süt", "180")),
    "Ice Latte": (("Kahve Çekirdeği", "18"), ("Süt", "200")),
    "Americano": (("Kahve Çekirdeği", "18"),),
    "Espresso": (("Kahve Çekirdeği", "9"),),
    "Filtre Kahve": (("Kahve Çekirdeği", "22"),),
    "Türk Kahvesi": (("Kahve Çekirdeği", "12"), ("Toz Şeker", "6")),
    "Ev Yapımı Limonata": (("Limon", "3"), ("Toz Şeker", "35")),
    "Ayran": (("Ayran (Şişe)", "1"),),
    "Kola": (("Kola (Kutu)", "1"),),
}


@dataclass(frozen=True)
class CampaignSpec:
    name: str
    description: str
    buy_category: str | None
    buy_quantity: int
    reward_kind: str
    reward_category: str | None
    reward_value: str
    audience: str
    minimum_order_amount: str = "0.00"
    max_uses_per_order: int = 1


CAMPAIGNS: tuple[CampaignSpec, ...] = (
    CampaignSpec(
        name="3 Kahveye 1 Bedava",
        description="Aynı adisyonda üç sıcak içecek alana dördüncüsü bizden.",
        buy_category="Sıcak İçecekler",
        buy_quantity=3,
        reward_kind="FREE_ITEM",
        reward_category="Sıcak İçecekler",
        reward_value="0.00",
        audience="EVERYONE",
        max_uses_per_order=2,
    ),
    CampaignSpec(
        name="Üyeye Tatlı İkramı",
        description="Sadakat üyelerine iki ana yemek siparişinde tatlı ikramı.",
        buy_category="Izgara & Ana Yemekler",
        buy_quantity=2,
        reward_kind="FREE_ITEM",
        reward_category="Tatlılar",
        reward_value="0.00",
        audience="MEMBERS_ONLY",
    ),
    CampaignSpec(
        name="Hafta İçi Öğle: %20",
        description="750 TL üzeri hafta içi öğle adisyonlarında ana yemeklerde %20 indirim.",
        buy_category="Izgara & Ana Yemekler",
        buy_quantity=1,
        reward_kind="PERCENT",
        reward_category="Izgara & Ana Yemekler",
        reward_value="20.00",
        audience="EVERYONE",
        minimum_order_amount="750.00",
    ),
)

CUSTOMER_EMAIL_DOMAIN = "ornekmusteri.com"

# Loyalty members. (first name, last name, email local part)
LOYALTY_CUSTOMERS: tuple[tuple[str, str, str], ...] = (
    ("Ayşe", "Yılmaz", "ayse.yilmaz"),
    ("Mehmet", "Kaya", "mehmet.kaya"),
    ("Zeynep", "Demir", "zeynep.demir"),
    ("Mustafa", "Şahin", "mustafa.sahin"),
    ("Elif", "Çelik", "elif.celik"),
    ("Ahmet", "Yıldız", "ahmet.yildiz"),
    ("Fatma", "Yıldırım", "fatma.yildirim"),
    ("Ali", "Öztürk", "ali.ozturk"),
    ("Hatice", "Aydın", "hatice.aydin"),
    ("Hüseyin", "Özdemir", "huseyin.ozdemir"),
    ("Emine", "Arslan", "emine.arslan"),
    ("İbrahim", "Doğan", "ibrahim.dogan"),
    ("Merve", "Kılıç", "merve.kilic"),
    ("Emre", "Aslan", "emre.aslan"),
    ("Seda", "Çetin", "seda.cetin"),
    ("Burak", "Kara", "burak.kara"),
    ("Büşra", "Koç", "busra.koc"),
    ("Onur", "Kurt", "onur.kurt"),
    ("Ece", "Özkan", "ece.ozkan"),
    ("Kerem", "Şimşek", "kerem.simsek"),
    ("Melis", "Polat", "melis.polat"),
    ("Serkan", "Erdoğan", "serkan.erdogan"),
    ("Gizem", "Aksoy", "gizem.aksoy"),
    ("Tolga", "Bulut", "tolga.bulut"),
    ("Pelin", "Güneş", "pelin.gunes"),
    ("Barış", "Yavuz", "baris.yavuz"),
    ("Damla", "Ateş", "damla.ates"),
    ("Cem", "Turan", "cem.turan"),
    ("Sinem", "Acar", "sinem.acar"),
    ("Kaan", "Ünal", "kaan.unal"),
    ("Derya", "Sönmez", "derya.sonmez"),
    ("Uğur", "Bozkurt", "ugur.bozkurt"),
    ("Nazlı", "Taş", "nazli.tas"),
    ("Halil", "Korkmaz", "halil.korkmaz"),
    ("Esra", "Duman", "esra.duman"),
    ("Yusuf", "Avcı", "yusuf.avci"),
    ("İrem", "Karaca", "irem.karaca"),
    ("Furkan", "Sarı", "furkan.sari"),
    ("Aslı", "Tekin", "asli.tekin"),
    ("Doruk", "Ergin", "doruk.ergin"),
    ("Bade", "Yalçın", "bade.yalcin"),
    ("Sarp", "Işık", "sarp.isik"),
    ("Nehir", "Gül", "nehir.gul"),
    ("Efe", "Balcı", "efe.balci"),
    ("Duru", "Aslantaş", "duru.aslantas"),
    ("Kuzey", "Çakır", "kuzey.cakir"),
    ("Lara", "Toprak", "lara.toprak"),
    ("Ozan", "Keskin", "ozan.keskin"),
    ("Yağmur", "Şen", "yagmur.sen"),
    ("Tuna", "Aydemir", "tuna.aydemir"),
)

# Walk-in names used on takeaway/delivery tickets and table guest labels.
GUEST_NAMES: tuple[str, ...] = (
    "Ahmet Bey", "Ayşe Hanım", "Selim Bey", "Nur Hanım", "Kaan Bey",
    "Ela Hanım", "Murat Bey", "Sevgi Hanım", "Deniz Bey", "Buse Hanım",
    "Tarık Bey", "Gül Hanım", "Levent Bey", "Şeyma Hanım", "Cenk Bey",
)

DELIVERY_DISTRICTS: tuple[tuple[str, str], ...] = (
    ("Kadıköy", "Caferağa"),
    ("Kadıköy", "Osmanağa"),
    ("Kadıköy", "Fenerbahçe"),
    ("Beşiktaş", "Sinanpaşa"),
    ("Beşiktaş", "Levent"),
    ("Beşiktaş", "Etiler"),
    ("Ataşehir", "Barbaros"),
    ("Maltepe", "Bağlarbaşı"),
    ("Üsküdar", "Acıbadem"),
    ("Şişli", "Teşvikiye"),
)

STREET_NAMES: tuple[str, ...] = (
    "Papatya Sok.", "Gül Sok.", "Bahar Cad.", "Zambak Sok.", "Yıldız Cad.",
    "Menekşe Sok.", "Lale Cad.", "Fulya Sok.", "Manolya Cad.", "Nergis Sok.",
)

# (method, relative weight)
PAYMENT_METHODS: tuple[tuple[str, int], ...] = (
    ("CARD", 58),
    ("CASH", 27),
    ("MEAL_CARD", 12),
    ("TRANSFER", 3),
)

DISCOUNT_REASONS: tuple[str, ...] = (
    "Müdavim müşteri indirimi",
    "Bekleme süresi telafisi",
    "Personel ikramı",
    "Kampanya uygulaması",
    "Sipariş hatası telafisi",
)

CANCELLATION_REASONS: tuple[str, ...] = (
    "Müşteri vazgeçti",
    "Yanlış ürün girildi",
    "Ürün stokta kalmadı",
    "Mutfak yetiştiremedi",
)
