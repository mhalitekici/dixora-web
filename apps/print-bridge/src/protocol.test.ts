import assert from "node:assert/strict";
import test from "node:test";

import { parseClaimedJobs } from "./protocol.js";

test("normalizes the current API print payload into the bridge document", () => {
  const [job] = parseClaimedJobs([
    {
      id: "job-1",
      tenant_id: "tenant-1",
      branch_id: "branch-1",
      preparation_station_id: "station-1",
      printer_device_id: "printer-device-1",
      printer_code: "MOCK-KITCHEN",
      order_id: "order-1",
      kitchen_ticket_id: "ticket-1",
      payload: {
        order_id: "order-1",
        ticket_id: "ticket-1",
        items: [{ name: "Burger", quantity: "1.00", note: "No onion" }],
      },
      kind: "ORIGINAL",
      attempt_count: 1,
      claimed_at: "2026-07-30T20:00:00Z",
      created_at: "2026-07-30T19:59:00Z",
    },
  ]);

  assert.ok(job);
  assert.equal(job.printerDeviceId, "MOCK-KITCHEN");
  assert.equal(job.document.orderNumber, "order-1");
  assert.equal(job.document.lines[0]?.name, "Burger");
});
