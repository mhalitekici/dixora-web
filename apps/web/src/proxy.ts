import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "dixora_access";
const REFRESH_COOKIE = "dixora_refresh";
const protectedRoots = ["/admin", "/waiter", "/cashier", "/kitchen", "/super-admin"];
const roleHomes: Record<string, string> = {
  SUPER_ADMIN: "/super-admin",
  BUSINESS_OWNER: "/admin",
  BUSINESS_MANAGER: "/admin",
  ACCOUNTANT: "/admin/reports",
  CASHIER: "/cashier",
  WAITER: "/waiter/tables",
  KITCHEN: "/kitchen",
  BAR: "/kitchen",
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const protectedPage = protectedRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
  const loginPage = pathname === "/login" || pathname === "/super-admin/login";

  const hasSession =
    request.cookies.has(ACCESS_COOKIE) || request.cookies.has(REFRESH_COOKIE);
  const role = hasSession
    ? readRole(request.cookies.get(ACCESS_COOKIE)?.value ?? "") ??
      readRole(request.cookies.get(REFRESH_COOKIE)?.value ?? "")
    : null;

  if (loginPage) {
    const home = role ? roleHomes[role] : undefined;
    if (home) {
      return NextResponse.redirect(new URL(home, request.url));
    }
    if (hasSession) {
      const response = NextResponse.next();
      clearSessionCookies(response);
      return response;
    }
    return NextResponse.next();
  }

  if (!protectedPage) {
    return NextResponse.next();
  }

  if (!hasSession) {
    return loginRedirect(request);
  }

  if (!role) {
    const response = loginRedirect(request);
    clearSessionCookies(response);
    return response;
  }
  if (!roleCanOpen(role, pathname)) {
    const target = roleHomes[role] ?? "/login";
    return NextResponse.redirect(new URL(target, request.url));
  }
  return NextResponse.next();
}

function clearSessionCookies(response: NextResponse) {
  const domain = readCookieDomain();
  const options = {
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  };
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    // Expire both variants. Deployments that added AUTH_COOKIE_DOMAIN after
    // launch can otherwise retain an older host-only session indefinitely.
    response.cookies.set(name, "", options);
    if (domain) {
      response.cookies.set(name, "", { ...options, domain });
    }
  }
}

function readCookieDomain(): string | undefined {
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (
    !domain ||
    domain.includes("://") ||
    domain.includes("/") ||
    domain.includes(":") ||
    /\s/.test(domain)
  ) {
    return undefined;
  }
  return domain;
}

function loginRedirect(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = pathname.startsWith("/super-admin") ? "/super-admin/login" : "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

function readRole(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(
      Buffer.from(normalized, "base64").toString("utf8"),
    ) as { role?: unknown; exp?: unknown };
    if (
      typeof decoded.role !== "string" ||
      (typeof decoded.exp === "number" && decoded.exp * 1000 <= Date.now())
    ) {
      return null;
    }
    return decoded.role;
  } catch {
    return null;
  }
}

function roleCanOpen(role: string, pathname: string) {
  if (pathname.startsWith("/super-admin")) return role === "SUPER_ADMIN";
  if (pathname.startsWith("/admin")) {
    if (role === "BUSINESS_OWNER") return true;
    if (role === "BUSINESS_MANAGER") {
      return ![
        "/admin/roles",
        "/admin/settings",
        "/admin/branch-settings",
      ].some((path) => pathname === path || pathname.startsWith(`${path}/`));
    }
    if (role === "ACCOUNTANT") {
      return (
        pathname === "/admin" ||
        pathname.startsWith("/admin/reports") ||
        pathname.startsWith("/admin/inventory")
      );
    }
    return false;
  }
  if (pathname.startsWith("/waiter")) {
    return ["WAITER", "BUSINESS_OWNER", "BUSINESS_MANAGER"].includes(role);
  }
  if (pathname.startsWith("/cashier")) {
    return ["CASHIER", "BUSINESS_OWNER", "BUSINESS_MANAGER"].includes(role);
  }
  if (pathname.startsWith("/kitchen")) {
    return ["KITCHEN", "BAR", "BUSINESS_OWNER", "BUSINESS_MANAGER"].includes(role);
  }
  return true;
}

export const config = {
  matcher: [
    "/login",
    "/admin/:path*",
    "/waiter/:path*",
    "/cashier/:path*",
    "/kitchen/:path*",
    "/super-admin/:path*",
  ],
};
