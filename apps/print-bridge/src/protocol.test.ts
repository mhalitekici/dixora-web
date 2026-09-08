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
  assert.equal(job.isTestPrint, false);
});

test("rejects a normal order print job without order_id", () => {
  assert.throws(
    () =>
      parseClaimedJobs([
        {
          id: "job-1",
          tenant_id: "tenant-1",
          branch_id: "branch-1",
          preparation_station_id: "station-1",
          printer_device_id: "printer-device-1",
          printer_code: "MOCK-KITCHEN",
          order_id: null,
          kitchen_ticket_id: null,
          payload: {
            content_type: "application/vnd.dixora.receipt+json",
            document: {
              title: "MUTFAK",
              branch_name: "Dixora",
              station_name: "Mutfak",
              order_number: "A100",
              submitted_at: "2026-07-30T20:00:00Z",
              lines: [{ name: "Burger", quantity: "1" }],
            },
          },
          kind: "ORIGINAL",
          attempt_count: 1,
          claimed_at: "2026-07-30T20:00:00Z",
          created_at: "2026-07-30T19:59:00Z",
        },
      ]),
    /order_id/,
  );
});

test("accepts a printer test job without order_id", () => {
  const [job] = parseClaimedJobs([
    {
      id: "job-1",
      tenant_id: "tenant-1",
      branch_id: "branch-1",
      preparation_station_id: null,
      printer_device_id: "printer-device-1",
      printer_code: "MOCK-KITCHEN",
      order_id: null,
      kitchen_ticket_id: null,
      payload: {
        document_type: "PRINTER_TEST",
        content_type: "application/vnd.dixora.receipt+json",
        copies: 1,
        is_reprint: false,
        document: {
          title: "YAZICI TESTİ",
          business_name: "Dixora Cafe",
          branch_name: "Dixora",
          station_name: "Mutfak",
          order_number: "TEST1234",
          submitted_at: "2026-07-30T20:00:00Z",
          lines: [
            {
              name: "DIXORA YAZICI TESTİ",
              quantity: "1",
              complimentary: true,
              adjustment_label: "İKRAM",
            },
          ],
        },
      },
      kind: "ORIGINAL",
      attempt_count: 1,
      claimed_at: "2026-07-30T20:00:00Z",
      created_at: "2026-07-30T19:59:00Z",
    },
  ]);

  assert.ok(job);
  assert.equal(job.orderId, null);
  assert.equal(job.kitchenTicketId, null);
  assert.equal(job.isTestPrint, true);
  assert.equal(job.document.orderNumber, "TEST1234");
  assert.equal(job.document.businessName, "Dixora Cafe");
  assert.equal(job.document.lines[0]?.complimentary, true);
  assert.equal(job.document.lines[0]?.adjustmentLabel, "İKRAM");
});
