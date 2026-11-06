import { test, expect } from "@playwright/test";

test("manager enters from admin and employee PIN login with a personal cashier shift", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByLabel("İşletme kodu", { exact: true }).fill("dixora-lab");
  await page.getByLabel("Kullanıcı adı veya e-posta").fill("owner@dixora.test");
  await page.getByLabel("Parola", { exact: true }).fill("DixoraLab!2026");
  await page.getByRole("button", { name: "Güvenli giriş yap" }).click();
  await page.waitForURL("**/admin");
  const origin = new URL(page.url()).origin;
  const me = await (await page.request.get("/api/auth/me")).json();
  const roles = await (await page.request.get("/api/backend/roles")).json();
  const username = `panelmanager${Date.now()}`;
  const created = await page.request.post("/api/backend/users", {
    headers: { origin },
    data: {
      username,
      display_name: username,
      role_id: roles.find(
        (r: { code: string }) => r.code === "BUSINESS_MANAGER",
      ).id,
      branch_id: me.branch.id,
      temporary_password: "Temporary!2026",
      pin: "7246",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const managerId = (await created.json()).id;
  let existing = await (
    await page.request.get("/api/backend/shifts/current")
  ).json();
  if (!existing) {
    const opened = await page.request.post("/api/backend/shifts/open", {
      headers: { origin },
      data: {
        username: "cashier@dixora.test",
        pin: "1357",
        opening_cash: "50",
      },
    });
    expect(opened.status(), await opened.text()).toBe(201);
    existing = await opened.json();
  }
  const adminContext = await browser.newContext({
    storageState: await page.context().storageState(),
  });
  const admin = await adminContext.newPage();
  await admin.goto(`${origin}/admin/panels`);
  await admin.getByLabel("Kullanıcı adı", { exact: true }).fill(username);
  await admin.getByLabel("PIN", { exact: true }).fill("9999");
  await admin.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(admin.locator("form").getByRole("alert")).toContainText("Kullanıcı adı veya PIN hatalı");
  expect((await (await admin.request.get(`${origin}/api/auth/me`)).json()).user.username).toBe("owner@dixora.test");
  await admin.getByLabel("PIN", { exact: true }).fill("7246");
  await admin.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await expect(
    admin.getByText("Hangi panele girmek istersiniz?", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await admin.request.get(`${origin}/api/auth/me`)).json()).user
      .username,
  ).toBe(username);
  await admin.getByRole("button", { name: /Kasiyer paneli/ }).click();
  await admin.waitForURL("**/cashier");
  await expect(
    admin.getByRole("heading", { name: "Kendi kasa vardiyanızı açın" }),
  ).toBeVisible();
  await admin.getByLabel("Açılış nakdi", { exact: true }).fill("0");
  await admin
    .getByRole("button", { name: "Kendi vardiyamı aç", exact: true })
    .click();
  await expect(
    admin.getByRole("heading", { name: "Kendi kasa vardiyanızı açın" }),
  ).not.toBeVisible();
  const own = await (
    await admin.request.get(`${origin}/api/backend/shifts/current`)
  ).json();
  expect(own.id).not.toBe(existing.id);
  expect(own.user_id).toBe(managerId);
  expect(
    await (await page.request.get(`/api/backend/shifts/${existing.id}`)).json(),
  ).toEqual(existing);
  const forbidden = await admin.request.post(
    `${origin}/api/backend/shifts/${existing.id}/close`,
    {
      headers: { origin },
      data: { username, pin: "7246", closing_cash: "50" },
    },
  );
  expect(forbidden.status()).toBe(403);
  await admin.getByRole("button", { name: "Panel seçimine dön" }).click();
  await admin.waitForURL("**/admin/panels");
  await admin.getByRole("button", { name: /Garson paneli/ }).click();
  await admin.waitForURL("**/waiter/tables");
  const employeeContext = await browser.newContext();
  await employeeContext.addCookies(
    (await page.context().cookies()).filter(
      (cookie) => cookie.name === "dixora_trusted_device",
    ),
  );
  const employee = await employeeContext.newPage();
  await employee.goto(`${origin}/login`);
  await employee
    .getByRole("tab", { name: "Çalışan girişi", exact: true })
    .click();
  await employee.getByLabel("İşletme kodu", { exact: true }).fill("dixora-lab");
  await employee.getByLabel("Şube kodu", { exact: true }).fill("merkez");
  await employee.getByLabel("Kullanıcı adı", { exact: true }).fill(username);
  await employee.getByLabel("PIN", { exact: true }).fill("7246");
  await employee.getByRole("button", { name: "PIN ile devam et" }).click();
  await employee.waitForURL("**/admin/panels");
  await expect(
    employee.getByRole("button", { name: /Garson paneli/ }),
  ).toBeVisible();
  await employee.getByRole("button", { name: /Kasiyer paneli/ }).click();
  await employee.waitForURL("**/cashier");
  expect(
    (
      await (
        await employee.request.get(`${origin}/api/backend/shifts/current`)
      ).json()
    ).id,
  ).toBe(own.id);
  await adminContext.close();
  await employeeContext.close();
});
