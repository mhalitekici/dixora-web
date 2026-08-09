import { describe, expect, it } from "vitest";

import {
  auditActionLabel,
  auditActionLabels,
  auditResourceLabel,
  hasFriendlyAuditLabel,
} from "./audit-labels";

describe("audit labels", () => {
  it("translates the technical action codes business owners actually see", () => {
    expect(auditActionLabel("order.created")).toBe("Yeni sipariş oluşturuldu");
    expect(auditActionLabel("payment.recorded")).toBe("Ödeme alındı");
    expect(auditActionLabel("order.bill_requested")).toBe("Hesap istendi");
    expect(auditActionLabel("loyalty.membership_enrolled")).toBe(
      "Yeni sadakat müşterisi kaydoldu",
    );
    expect(auditActionLabel("order.items_appended")).toBe("Siparişe ürün eklendi");
    expect(auditActionLabel("printing.job_created")).toBe("Yazdırma işi oluşturuldu");
  });

  it("never leaks a raw dotted code for a known action", () => {
    for (const [action, label] of Object.entries(auditActionLabels)) {
      expect(label).not.toContain(".");
      expect(label).not.toBe(action);
    }
  });

  it("degrades gracefully for an action added later in the backend", () => {
    // Unknown codes must stay visible, just humanised.
    expect(auditActionLabel("something.brand_new")).toBe("Something brand new");
    expect(hasFriendlyAuditLabel("something.brand_new")).toBe(false);
    expect(hasFriendlyAuditLabel("order.created")).toBe(true);
  });

  it("translates resource types and tolerates unknown ones", () => {
    expect(auditResourceLabel("order")).toBe("Sipariş");
    expect(auditResourceLabel("hotel_room")).toBe("Otel odası");
    expect(auditResourceLabel(null)).toBeNull();
    expect(auditResourceLabel("brand_new_thing")).toBe("brand new thing");
  });
});
