import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

function roleToken(role: string, expiresInSeconds = 300, staffSession = false) {
  const payload = Buffer.from(
    JSON.stringify({
      role,
      staff_session: staffSession,
      exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("auth proxy", () => {
  it.each(["/admin", "/admin/employees", "/admin/panels", "/login"])(
    "keeps a manager employee session outside %s",
    (path) => {
      const response = proxy(
        request(
          path,
          `dixora_refresh=${roleToken("BUSINESS_MANAGER", 300, true)}`,
        ),
      );
      expect(response.headers.get("location")).toBe("http://localhost/panels");
    },
  );
  it("opens the standalone chooser without exposing the admin workspace", () => {
    expect(
      proxy(
        request(
          "/panels",
          `dixora_access=${roleToken("BUSINESS_MANAGER", 300, true)}`,
        ),
      ).headers.get("x-middleware-next"),
    ).toBe("1");
    expect(proxy(request("/panels")).headers.get("location")).toContain(
      "/login?",
    );
  });
  it.each([
    "/admin",
    "/admin/printers",
    "/admin/loyalty",
    "/waiter/tables",
    "/cashier",
  ])("allows the business administrator to open %s", (path) => {
    const response = proxy(
      request(path, `dixora_refresh=${roleToken("BUSINESS_ADMIN")}`),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a logged-out back navigation to login", () => {
    const response = proxy(request("/admin/orders?status=PAID"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/login?returnTo=%2Fadmin%2Forders%3Fstatus%3DPAID",
    );
  });

  it("redirects an authenticated user away from the login page", () => {
    const response = proxy(
      request("/login", `dixora_refresh=${roleToken("BUSINESS_OWNER")}`),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/admin");
  });

  it("allows a persisted refresh cookie to reopen the protected workspace", () => {
    const response = proxy(
      request("/admin", `dixora_refresh=${roleToken("BUSINESS_OWNER")}`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
