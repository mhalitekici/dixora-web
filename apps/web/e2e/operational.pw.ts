import { test, expect, devices, webkit, type Page } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

const evidence = path.resolve(
  import.meta.dirname,
  "../../..",
  "docs/evidence/operational-2026-11-04",
);
async function login(page: Page, username = "owner@dixora.test") {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Güvenli giriş yap" }),
  ).toBeEnabled();
  await page.getByLabel("İşletme kodu", { exact: true }).fill("dixora-lab");
  await page.getByLabel("Kullanıcı adı veya e-posta").fill(username);
  await page.getByLabel("Parola", { exact: true }).fill("DixoraLab!2026");
  await expect(
    page.getByRole("button", { name: "Güvenli giriş yap" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Güvenli giriş yap" }).click();
  await page.waitForURL(
    username.startsWith("waiter")
      ? "**/waiter/tables"
      : username.startsWith("cashier")
        ? "**/cashier"
        : "**/admin",
  );
  await expect(page.getByText("Giriş başarılı", { exact: true })).toHaveCount(
    0,
  );
}

test.beforeAll(async ({ request }) => {
  await expect
    .poll(
      async () => {
        try {
          return (await request.get("http://127.0.0.1:18000/ready")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(200);
});

test("manager must authenticate an employee before panel selection", async ({
  page,
}) => {
  await login(page);
  await page.goto("/cashier");
  await expect(
    page.getByRole("link", { name: "Panellerden yetkili giriş yap" }),
  ).toBeVisible();
  await page.goto("/admin/panels");
  await expect(page.getByLabel("Kullanıcı adı", { exact: true })).toBeVisible();
  await expect(page.getByLabel("PIN", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Kasiyer paneli/ }),
  ).toHaveCount(0);
});

test("report PDF downloads with applied date filters", async ({ page }) => {
  await login(page);
  await page.goto("/admin/reports");
  const dateTo = await page.getByLabel("Bitiş", { exact: true }).inputValue();
  const dateFrom = `${dateTo.slice(0, 8)}01`;
  await page.getByLabel("Başlangıç", { exact: true }).fill(dateFrom);
  await page.getByLabel("Bitiş", { exact: true }).fill(dateTo);
  await page.getByRole("button", { name: "Raporu getir", exact: true }).click();
  const pdf = page.getByRole("button", { name: "PDF olarak indir" });
  await expect(pdf).toBeVisible();
  const response = page.waitForResponse((res) =>
    res.url().includes("reports/export.pdf"),
  );
  const downloaded = page.waitForEvent("download");
  await pdf.click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect(result.url()).toContain(`date_from=${dateFrom}`);
  expect(result.url()).toContain(`date_to=${dateTo}`);
  expect(result.headers()["content-type"]).toContain("application/pdf");
  const file = await downloaded;
  expect(file.suggestedFilename()).toContain("dixora-rapor-");
  const saved = path.join(evidence, "sample-report.pdf");
  await file.saveAs(saved);
  expect((await readFile(saved)).subarray(0, 5).toString()).toBe("%PDF-");
  await page.screenshot({
    path: path.join(evidence, "reports.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
});

test("waiter tables fit all requested viewports and themes", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page, "waiter@dixora.test");
  const tables = await (await page.request.get("/api/backend/tables")).json();
  const products = (
    await (await page.request.get("/api/backend/catalog/products")).json()
  ).items;
  const created = await page.request.post("/api/backend/orders", {
    data: {
      table_id: tables[0].id,
      idempotency_key: `responsive-${Date.now()}`,
      items: [
        {
          product_id: products.find(
            (item: { name: string }) => item.name === "Homemade Lemonade",
          ).id,
          quantity: "1",
          note: "Uzun Türkçe sipariş açıklaması, sos ayrı ve buzsuz. ".repeat(
            8,
          ),
        },
      ],
    },
    headers: { origin: "http://localhost:13000" },
  });
  expect(created.status()).toBe(201);
  const order = await created.json();
  for (const width of [320, 360, 375, 390, 412, 430, 768, 1024, 1440]) {
    await page.goto("/waiter/tables");
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await expect(
      page.getByRole("heading", { name: "Masalarım", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 390 || width === 1440)
      await page.screenshot({
        path: path.join(evidence, `waiter-tables-${width}.png`),
        fullPage: true,
        style:
          'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
      });
    for (const route of [
      "/waiter/orders",
      `/waiter/orders/${order.id}`,
      `/waiter/tables/${tables[0].id}`,
      "/waiter/notifications",
      "/profile",
    ]) {
      await page.goto(route);
      await expect(
        page.locator("main").getByRole("heading").first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `${route} at ${width}px`,
      ).toBe(true);
    }
  }
  await page.goto("/waiter/tables");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Android emulation places an order with modifiers and reconnects", async ({
  browser,
}) => {
  const context = await browser.newContext({
    ...devices["Pixel 7"],
    baseURL: "http://localhost:13000",
  });
  const page = await context.newPage();
  await login(page, "waiter@dixora.test");
  const tables = await (await page.request.get("/api/backend/tables")).json();
  const table =
    tables.find((row: { state: string }) => row.state === "AVAILABLE") ??
    tables[0];
  await page.goto(`/waiter/tables/${table.id}`);
  const coffee = page.getByRole("button", { name: /Classic Burger/ });
  await expect(coffee).toBeVisible();
  await coffee.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("checkbox", { name: /Extra Cheese/ }).check();
  await dialog
    .getByLabel("Ürün notu")
    .fill("Soğansız, sos ayrı; mobil kabul testi");
  await dialog.getByRole("button", { name: /Siparişe ekle/ }).click();
  await page.getByRole("button", { name: /1 yeni kalem/ }).click();
  await page
    .getByRole("button", { name: "1 yeni kalemi gönder", exact: true })
    .click();
  await expect(
    page.getByText("Sipariş mutfağa gönderildi", { exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("status").filter({ hasText: "İnternet bağlantısı yok" }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole("status").filter({ hasText: "İnternet bağlantısı yok" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Canlı bağlantı açık", { exact: true }),
  ).toBeAttached({ timeout: 30_000 });
  const refreshed = await page.request.get(
    `/api/backend/tables/${table.id}/active-order`,
  );
  expect(refreshed.status()).toBe(200);
  const savedOrder = await refreshed.json();
  expect(
    savedOrder.items.some((item: { note?: string }) =>
      item.note?.includes("mobil kabul testi"),
    ),
  ).toBe(true);
  const bill = await page.request.post(
    `/api/backend/orders/${savedOrder.id}/bill-request`,
    { headers: { origin: "http://localhost:13000" } },
  );
  expect(bill.status()).toBe(200);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: path.join(evidence, "waiter-order-android.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
  await page.goto("/waiter/notifications");
  await expect(
    page.locator(`a[href="/waiter/orders/${savedOrder.id}"]`),
  ).toContainText("Müşteri hesap istedi");
  await page.screenshot({
    path: path.join(evidence, "waiter-notifications-android.png"),
    fullPage: true,
  });
  await context.close();
});

test("custom waiter role can order but cannot record payments", async ({
  page,
  browser,
}) => {
  await login(page);
  const suffix = Date.now().toString();
  const name = `Garson Sınırlı ${suffix}`;
  await page.goto("/admin/roles");
  await page.getByRole("button", { name: "Yeni rol oluştur" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Rol adı").fill(name);
  for (const permission of [
    "Masaları görme",
    "Ürünleri görme",
    "Siparişleri görme",
    "Sipariş oluşturma ve ürün ekleme",
  ]) {
    await dialog
      .getByRole("checkbox", { name: permission, exact: true })
      .check();
  }
  await expect(
    dialog.getByRole("checkbox", { name: "Ödeme ve iade kaydetme" }),
  ).not.toBeChecked();
  await dialog.getByRole("button", { name: "Rolü kaydet" }).click();
  await expect(
    page.getByRole("heading", { name: new RegExp(name) }),
  ).toBeVisible();
  const roles = await (await page.request.get("/api/backend/roles")).json();
  const role = roles.find((row: { name: string }) => row.name === name);
  await page.goto("/admin/employees");
  await page.getByRole("button", { name: "Çalışan ekle" }).click();
  const employee = page.getByRole("dialog");
  const username = `waiter${suffix}`;
  await employee.getByLabel("Ad soyad").fill(name);
  await employee.getByLabel("Kullanıcı adı", { exact: true }).fill(username);
  await employee
    .getByLabel("Geçici parola", { exact: true })
    .fill("DixoraLab!2026");
  await employee.getByLabel("Rol", { exact: true }).selectOption(role.id);
  const branches = await (
    await page.request.get("/api/backend/branches")
  ).json();
  await employee
    .getByLabel("Şube", { exact: true })
    .selectOption(branches[0].id);
  await employee.getByRole("button", { name: "Hesabı oluştur" }).click();
  await expect(employee).not.toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "custom-role-employee.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
  const context = await browser.newContext({
    baseURL: "http://localhost:13000",
  });
  const staff = await context.newPage();
  await login(staff, username);
  const tables = await (await staff.request.get("/api/backend/tables")).json();
  const productPage = await (
    await staff.request.get("/api/backend/catalog/products")
  ).json();
  const products = productPage.items ?? productPage;
  const order = await staff.request.post("/api/backend/orders", {
    data: {
      table_id: tables[0].id,
      idempotency_key: `role-order-${suffix}`,
      items: [{ product_id: products[0].id, quantity: "1" }],
    },
    headers: { origin: "http://localhost:13000" },
  });
  expect(order.status()).toBe(201);
  const payment = await staff.request.post(
    `/api/backend/orders/${(await order.json()).id}/payments`,
    {
      data: {
        method: "CASH",
        amount: "1",
        idempotency_key: `role-pay-${suffix}`,
      },
      headers: { origin: "http://localhost:13000" },
    },
  );
  expect(payment.status()).toBe(403);
  await context.close();
});

test("product images upload, refresh in admin and QR, and delete", async ({
  page,
}) => {
  await login(page);
  const productPage = await (
    await page.request.get("/api/backend/catalog/products")
  ).json();
  const products = productPage.items ?? productPage;
  const product = products.find(
    (row: { name: string }) => row.name === "Classic Burger",
  );
  const origin = { origin: "http://localhost:13000" };
  const png = Buffer.from(
    await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ec5a20";
      context.fillRect(0, 0, 128, 128);
      return canvas.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  let previous = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const upload = await page.request.post(
      `/api/backend/media/products/${product.id}/image`,
      {
        multipart: {
          file: { name: "test.png", mimeType: "image/png", buffer: png },
        },
        headers: origin,
      },
    );
    expect(upload.status()).toBe(200);
    const current = (await upload.json()).image_url;
    const currentPath = new URL(current, "http://localhost:13000").pathname;
    expect(current).not.toBe(previous);
    previous = current;
    await page.goto("/admin/products");
    const row = page.getByRole("row").filter({ hasText: "Classic Burger" });
    const image = row.locator("img");
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty(
      "src",
      `http://localhost:13000${currentPath}`,
    );
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await row.getByRole("button", { name: "Ürün işlemleri" }).click();
    await page.getByRole("menuitem", { name: "Ürünü düzenle" }).click();
    const preview = page.getByRole("img", {
      name: "Classic Burger görsel önizlemesi",
    });
    await expect(preview).toHaveJSProperty(
      "src",
      `http://localhost:13000${currentPath}`,
    );
    await page.getByRole("button", { name: "Vazgeç", exact: true }).click();
    await page.goto("/m/dixora-lab/merkez");
    const qrImage = page
      .getByRole("button", { name: /Classic Burger/ })
      .locator("img");
    await expect(qrImage).toBeVisible();
    await expect(qrImage).toHaveJSProperty(
      "src",
      `http://localhost:13000${currentPath}`,
    );
    await expect
      .poll(() =>
        qrImage.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  await page.goto("/admin/products");
  await page
    .getByRole("row")
    .filter({ hasText: "Classic Burger" })
    .getByRole("button", { name: "Ürün işlemleri" })
    .click();
  await page.getByRole("menuitem", { name: "Ürünü düzenle" }).click();
  await page
    .getByLabel("Ürün görseli", { exact: true })
    .setInputFiles({ name: "crop.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("heading", { name: "Ürün görselini düzenle" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Kırpmayı uygula" }).click();
  const imageUpload = page.waitForResponse(
    (res) =>
      res.url().includes(`/media/products/${product.id}/image`) &&
      res.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Değişiklikleri kaydet", exact: true })
    .click();
  const savedImage = await imageUpload;
  expect(savedImage.status()).toBe(200);
  const savedPath = new URL(
    (await savedImage.json()).image_url,
    "http://localhost:13000",
  ).pathname;
  expect(savedPath).not.toBe(
    new URL(previous, "http://localhost:13000").pathname,
  );
  await page.goto("/m/dixora-lab/merkez");
  await expect(
    page.getByRole("button", { name: /Classic Burger/ }).locator("img"),
  ).toHaveJSProperty("src", `http://localhost:13000${savedPath}`);
  await page.screenshot({
    path: path.join(evidence, "qr-product-image.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
  expect(
    (
      await page.request.delete(
        `/api/backend/media/products/${product.id}/image`,
        { headers: origin },
      )
    ).status(),
  ).toBe(204);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Classic Burger/ }).locator("img"),
  ).toHaveCount(0);
});

test("courier form creates one original receipt with the complete address", async ({
  page,
}) => {
  await login(page, "cashier@dixora.test");
  await page.goto("/cashier/delivery");
  await page.getByRole("button", { name: "Yeni Paket Siparişi" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Telefon", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Paket Servis", exact: true })
    .click();
  await dialog.getByLabel("Müşteri adı").fill("Tarayıcı Kabul");
  await dialog.getByLabel("Telefon", { exact: true }).fill("05551112233");
  await dialog.getByLabel("İl (zorunlu)", { exact: true }).fill("İstanbul");
  await dialog.getByLabel("İlçe (zorunlu)", { exact: true }).fill("Kadıköy");
  await dialog.getByLabel("Mahalle", { exact: true }).fill("Caferağa");
  await dialog
    .getByLabel("Açık adres (zorunlu)")
    .fill("Moda Caddesi No 42 Daire 9");
  await dialog
    .getByLabel("Adres tarifi")
    .fill("Şişli sokağından giriniz; üçüncü kat");
  await dialog.getByRole("button", { name: /Homemade Lemonade/ }).click();
  await page.screenshot({
    path: path.join(evidence, "courier-address.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
  const response = page.waitForResponse(
    (res) =>
      res.url().endsWith("/api/backend/delivery") &&
      res.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Siparişi oluştur", exact: true })
    .click();
  const result = await response;
  expect(result.status()).toBe(201);
  const delivery = await result.json();
  expect(delivery.city).toBe("İstanbul");
  const headers = { origin: "http://localhost:13000" };
  const printer = await page.request.post("/api/backend/printing/devices", {
    data: {
      code: `E2E-${Date.now()}`,
      name: "Kurye kabul simülasyonu",
      purpose: "CASHIER",
      transport: "MOCK",
    },
    headers,
  });
  expect(printer.status()).toBe(201);
  const command = {
    order_id: delivery.order_id,
    printer_device_id: (await printer.json()).id,
    payload: { type: "COURIER" },
    idempotency_key: `courier-e2e-${delivery.id}`,
  };
  const first = await page.request.post("/api/backend/printing/jobs", {
    data: command,
    headers,
  });
  expect(first.status()).toBe(201);
  const job = await first.json();
  const replay = await page.request.post("/api/backend/printing/jobs", {
    data: command,
    headers,
  });
  expect((await replay.json()).id).toBe(job.id);
  expect(job.payload.document.title).toBe("PAKET SERVİS");
  expect(job.payload.document.delivery_address).toContain("İstanbul");
  expect(job.payload.document.delivery_address).toContain("Kadıköy");
  expect(job.payload.document.footer.join(" ")).toContain("üçüncü kat");
});

test("removing a bridge hides it and rejects the old token", async ({
  page,
}) => {
  await login(page);
  const name = `Eski bilgisayar ${Date.now()}`;
  const bridgeResponse = await page.request.post(
    "/api/backend/printing/bridges",
    { data: { name }, headers: { origin: "http://localhost:13000" } },
  );
  expect(bridgeResponse.status()).toBe(201);
  const bridge = await bridgeResponse.json();
  await page.goto("/admin/printers");
  const label = page.getByText(name, { exact: true });
  await expect(label).toBeVisible();
  await label
    .locator("../../..")
    .getByRole("button", { name: "Bağlantıyı kaldır" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Bağlantıyı kaldır", exact: true })
    .click();
  await expect(label).toHaveCount(0);
  const old = await page.request.post(
    "http://127.0.0.1:18000/api/v1/printing/bridge/claim",
    { headers: { "X-Print-Bridge-Token": bridge.token } },
  );
  expect(old.status()).toBe(401);
  await page.getByRole("button", { name: "Kaldırılan bağlantılar" }).click();
  await expect(label).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "revoked-bridge.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
});

test("iOS WebKit emulation supports navigation, focus, themes and rotation", async () => {
  const browser = await webkit.launch();
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: "http://localhost:13000",
  });
  const page = await context.newPage();
  await login(page, "waiter@dixora.test");
  for (const route of [
    "/waiter/tables",
    "/waiter/orders",
    "/waiter/notifications",
    "/profile",
  ]) {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/waiter/tables");
  await page.getByRole("searchbox", { name: "Masa veya müşteri ara" }).focus();
  await expect(
    page.getByRole("searchbox", { name: "Masa veya müşteri ara" }),
  ).toBeFocused();
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: path.join(evidence, "waiter-ios-dark.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
  await page.setViewportSize({ width: 844, height: 390 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
  await browser.close();
});

test("cashier opens and reconciles own shift; manager sees immutable history", async ({
  page,
  browser,
}) => {
  await login(page, "cashier@dixora.test");
  const existing = await (
    await page.request.get("/api/backend/shifts/current")
  ).json();
  expect(existing).toBeNull();
  await page
    .getByLabel("Kullanıcı adı", { exact: true })
    .fill("cashier@dixora.test");
  await page.getByLabel("PIN", { exact: true }).fill("1357");
  await page.getByRole("button", { name: "Devam", exact: true }).click();
  await page.getByLabel("Açılış nakdi", { exact: true }).fill("100.00");
  await page.getByRole("button", { name: "Vardiyayı Aç", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Masalar", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "cashier-square-tables.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
  const tables = await (await page.request.get("/api/backend/tables")).json();
  const products = (
    await (await page.request.get("/api/backend/catalog/products")).json()
  ).items;
  const product = products.find(
    (item: { name: string }) => item.name === "Homemade Lemonade",
  );
  const headers = { origin: "http://localhost:13000" };
  const suffix = Date.now();
  const created = await page.request.post("/api/backend/orders", {
    data: {
      table_id: tables.find(
        (row: { state: string }) => row.state === "AVAILABLE",
      ).id,
      items: [{ product_id: product.id, quantity: "1" }],
      idempotency_key: `cashier-browser-${suffix}`,
    },
    headers,
  });
  expect(created.status()).toBe(201);
  const order = await created.json();
  const command = {
    method: "CASH",
    amount: order.total,
    idempotency_key: `cashier-payment-${suffix}`,
  };
  const first = await page.request.post(
    `/api/backend/orders/${order.id}/payments`,
    { data: command, headers },
  );
  expect(first.status()).toBe(201);
  const retry = await page.request.post(
    `/api/backend/orders/${order.id}/payments`,
    { data: command, headers },
  );
  expect((await retry.json()).id).toBe((await first.json()).id);
  const shift = await (
    await page.request.get("/api/backend/shifts/current")
  ).json();
  await page.goto("/cashier/shift");
  await page
    .getByLabel("Kullanıcı adı", { exact: true })
    .fill("cashier@dixora.test");
  await page.getByLabel("PIN", { exact: true }).fill("1357");
  await page.getByLabel("Sayılmış kapanış nakdi").fill(shift.expected_cash);
  await page.getByLabel("POS / Z kart toplamı").fill("0.00");
  const closed = page.waitForResponse((res) =>
    res.url().includes(`/shifts/${shift.id}/close`),
  );
  await page.getByRole("button", { name: "Özeti Onayla ve Kapat" }).click();
  const final = await closed;
  expect(final.status()).toBe(200);
  expect((await final.json()).cash_variance).toBe("0.00");
  const context = await browser.newContext({
    baseURL: "http://localhost:13000",
  });
  const manager = await context.newPage();
  await login(manager);
  const history = await (
    await manager.request.get(
      "/api/backend/shifts/history?status=CLOSED&limit=50",
    )
  ).json();
  const record = history.find((item: { id: string }) => item.id === shift.id);
  expect(record.expected_cash).toBe(shift.expected_cash);
  expect(record.cash_variance).toBe("0.00");
  await manager.goto("/admin/shifts");
  await expect(
    manager.getByRole("button", { name: "Vardiya geçmişi", exact: true }),
  ).toBeVisible();
  await manager.screenshot({
    path: path.join(evidence, "shift-history.png"),
    fullPage: true,
    style:
      'nextjs-portal, button[aria-label="Open Tanstack query devtools"] { visibility: hidden !important; }',
  });
  await context.close();
});

test("audit details explain role permissions in Turkish", async ({ page }) => {
  await login(page);
  const created = await page.request.post("/api/backend/roles", {
    data: {
      code: `AUDIT_${Date.now()}`,
      name: "Denetim kabul rolü",
      operational_profile: "WAITER",
      permission_codes: ["orders.read", "orders.create", "tables.read"],
    },
    headers: { origin: "http://localhost:13000" },
  });
  expect(created.status()).toBe(201);
  await page.goto("/admin/audit-logs");
  const record = page
    .getByRole("row")
    .filter({ hasText: "Özel rol oluşturuldu" })
    .first();
  await expect(record).toContainText("İşletme sahibi");
  await record
    .getByRole("button", { name: "Denetim kaydı detayını aç" })
    .click();
  const details = page.getByRole("dialog");
  await expect(details.getByText("Yetkiler", { exact: true })).toBeVisible();
  await expect(details.locator("tbody")).toContainText(
    "Sipariş oluşturma ve ürün ekleme",
  );
  await expect(details.locator("tbody")).toContainText("Siparişleri görme");
  await expect(details.locator("tbody")).not.toContainText('["');
  await expect(details.getByText("Teknik detayları göster")).toBeVisible();
  await page.screenshot({
    path: path.join(evidence, "audit-readable.png"),
    fullPage: true,
  });
});
