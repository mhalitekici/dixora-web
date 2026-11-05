import { test, expect } from "@playwright/test";

test("manager enters both panels with own PIN and cashier stays observation only", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByLabel("İşletme kodu", { exact: true }).fill("dixora-lab");
  await page.getByLabel("Kullanıcı adı veya e-posta").fill("owner@dixora.test");
  await page.getByLabel("Parola", { exact: true }).fill("DixoraLab!2026");
  await page.getByRole("button", { name: "Güvenli giriş yap" }).click();
  await page.waitForURL("**/admin");
  const me = await (await page.request.get("/api/auth/me")).json();
  const roles = await (await page.request.get("/api/backend/roles")).json();
  const username = `panelmanager${Date.now()}`;
  const created = await page.request.post("/api/backend/users", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      username,
      display_name: username,
      role_id: roles.find(
        (role: { code: string }) => role.code === "BUSINESS_MANAGER",
      ).id,
      branch_id: me.branch.id,
      temporary_password: "Temporary!2026",
      pin: "7246",
    },
  });
  expect(created.status()).toBe(201);
  const context = await browser.newContext();
  const manager = await context.newPage();
  await manager.goto(new URL("/login", page.url()).href);
  await manager.getByLabel("İşletme kodu", { exact: true }).fill("dixora-lab");
  await manager.getByLabel("Kullanıcı adı veya e-posta").fill(username);
  await manager.getByLabel("Parola", { exact: true }).fill("Temporary!2026");
  await manager.getByRole("button", { name: "Güvenli giriş yap" }).click();
  await manager.waitForURL("**/admin");
  await manager.goto(new URL("/admin/panels", page.url()).href);
  await expect(
    manager.getByLabel("Kullanıcı adı", { exact: true }),
  ).toHaveValue(username);
  await manager.getByLabel("Doğrulama yöntemi").selectOption("pin");
  await manager.getByLabel("Kasiyer", { exact: true }).check();
  await manager.getByLabel("PIN", { exact: true }).fill("9999");
  await manager
    .getByRole("button", { name: "Yetkili giriş", exact: true })
    .click();
  await expect(manager.locator("form").getByRole("alert")).toContainText("Aktif hesabınızın");
  await expect(manager.getByLabel("PIN", { exact: true })).toHaveValue("");
  await manager.getByLabel("PIN", { exact: true }).fill("7246");
  await manager
    .getByRole("button", { name: "Yetkili giriş", exact: true })
    .click();
  await manager.waitForURL("**/cashier");
  await expect(
    manager.getByRole("heading", { name: "Kasa gözlem ekranı" }),
  ).toBeVisible();
  await expect(
    manager.getByRole("button", { name: /Ödeme al|Vardiya aç/ }),
  ).toHaveCount(0);
  await manager.getByRole("button", { name: "Destek modundan çık" }).click();
  await manager.waitForURL("**/admin/panels");
  await manager.getByLabel("Doğrulama yöntemi").selectOption("pin");
  await manager.getByLabel("Garson", { exact: true }).check();
  await manager.getByLabel("PIN", { exact: true }).fill("7246");
  await manager
    .getByRole("button", { name: "Yetkili giriş", exact: true })
    .click();
  await manager.waitForURL("**/waiter/tables");
  await expect(
    manager.getByRole("status").filter({ hasText: "Operasyon destek modu" }),
  ).toBeVisible();
  await context.close();
});
