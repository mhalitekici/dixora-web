import { describe, expect, it } from "vitest";
import { connectionLabel } from "./connection-store";

describe("operational connection status", () => {
  it("does not claim a live connection just because the browser has internet", () => {
    expect(connectionLabel(true, "closed")).toBe("Yeniden bağlanıyor");
    expect(connectionLabel(true, "connecting")).toBe("Yeniden bağlanıyor");
    expect(connectionLabel(true, "open")).toBe("Canlı bağlantı açık");
    expect(connectionLabel(false, "open")).toBe("Çevrimdışı");
  });
});
