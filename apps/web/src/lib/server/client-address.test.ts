import { describe, expect, it } from "vitest";

import {
  clientAddress,
  clientAddressHeaders,
} from "@/lib/server/client-address";

function request(headers: Record<string, string>): Request {
  return new Request("https://dixoratech.com/api/backend/orders", { headers });
}

describe("clientAddress", () => {
  it("takes the hop our own proxy appended, not one the caller supplied", () => {
    // A caller who writes their own X-Forwarded-For must not be able to choose
    // which address the API rate-limits and audits.
    expect(
      clientAddress(
        request({ "x-forwarded-for": "10.0.0.9, 203.0.113.7" }),
      ),
    ).toBe("203.0.113.7");
  });

  it("reads a single-entry header from a proxy that overwrites it", () => {
    expect(clientAddress(request({ "x-forwarded-for": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientAddress(request({ "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4",
    );
  });

  it("keeps IPv6 addresses intact", () => {
    expect(clientAddress(request({ "x-forwarded-for": "2001:db8::1" }))).toBe(
      "2001:db8::1",
    );
    expect(
      clientAddress(request({ "x-forwarded-for": "[2001:db8::1]:443" })),
    ).toBe("2001:db8::1");
  });

  it("drops the port from an IPv4 address", () => {
    expect(
      clientAddress(request({ "x-forwarded-for": "203.0.113.7:54321" })),
    ).toBe("203.0.113.7");
  });

  it("reports nothing rather than something unparseable", () => {
    // Forwarding "unknown" would tell the API to trust a value that means
    // nothing; with no header it uses the connecting socket instead.
    expect(clientAddress(request({ "x-forwarded-for": "unknown" }))).toBeNull();
    expect(clientAddress(request({ "x-forwarded-for": "  " }))).toBeNull();
    expect(clientAddress(request({}))).toBeNull();
  });

  it("emits no header when the address is unknown", () => {
    expect(clientAddressHeaders(request({}))).toEqual({});
    expect(
      clientAddressHeaders(request({ "x-forwarded-for": "203.0.113.7" })),
    ).toEqual({ "x-forwarded-for": "203.0.113.7" });
  });
});
