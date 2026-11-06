import { test, expect } from "@playwright/test";
test("employee defaults to current branch despite alphabetical branch order and can sign in", async ({
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
  const branches = await (
    await page.request.get("/api/backend/branches")
  ).json();
  test.skip(branches.length < 2, "Requires the multi-branch validation fixture");
  const current = branches[branches.length - 1].id;
  if (me.branch.id !== current) {
    const switched = await page.request.post("/api/auth/switch-branch", {
      headers: {origin: new URL(page.url()).origin},
      data: {branch_id: current},
    });
    expect(switched.status()).toBe(200);
    await page.reload();
  }
  expect(branches[0].id).not.toBe(current);
  await page.goto("/admin/employees");
  await page.getByRole("button", { name: "Çalışan ekle" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByLabel("Şube", { exact: true })).toHaveValue(current);
  const username = `branchfix${Date.now()}`;
  await form.getByLabel("Ad soyad").fill(username);
  await form.getByLabel("Kullanıcı adı", { exact: true }).fill(username);
  await form
    .getByLabel("Geçici parola", { exact: true })
    .fill("DixoraLab!2026");
  await form.getByRole("button", { name: "Hesabı oluştur" }).click();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: username }),
  ).toBeVisible();
  const users = await (await page.request.get("/api/backend/users")).json();
  expect(
    users.find(
      (u: { username: string; branch_id: string }) => u.username === username,
    ).branch_id,
  ).toBe(current);
  const context = await browser.newContext();
  const result = await context.request.post(
    "http://localhost:13000/api/auth/login",
    {
      headers: { origin: "http://localhost:13000" },
      data: {
        business_slug: "dixora-lab",
        identifier: username,
        password: "DixoraLab!2026",
        remember_me: false,
      },
    },
  );
  expect(result.status(), await result.text()).toBe(200);
  await context.close();
});
