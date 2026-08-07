import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { PrintBridgeApiClient } from "./api-client.js";
import type { BridgeConfig } from "./config.js";

test("uses the current FastAPI bridge contract end to end", async (context) => {
  let claimCount = 0;
  const requests: Array<{
    idempotencyKey: string | undefined;
    method: string | undefined;
    path: string | undefined;
    status: string | undefined;
  }> = [];

  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      const parsedBody = body
        ? (JSON.parse(body) as { status?: string })
        : undefined;
      const idempotencyHeader = request.headers["idempotency-key"];
      requests.push({
        idempotencyKey: Array.isArray(idempotencyHeader)
          ? idempotencyHeader[0]
          : idempotencyHeader,
        method: request.method,
        path: request.url,
        status: parsedBody?.status,
      });

      assert.equal(request.headers["x-print-bridge-token"], "bridge-secret");
      response.setHeader("Content-Type", "application/json");

      if (request.url?.startsWith("/api/v1/printing/bridge/claim")) {
        claimCount += 1;
        response.end(
          claimCount === 1
            ? JSON.stringify({
                id: "job-1",
                tenant_id: "tenant-1",
                branch_id: "branch-1",
                preparation_station_id: "station-1",
                printer_device_id: "printer-device-1",
                printer_code: "MOCK-KITCHEN",
                order_id: "order-1",
                kitchen_ticket_id: "ticket-1",
                payload: {
                  items: [{ name: "Burger", quantity: "1.00" }],
                },
                kind: "ORIGINAL",
                attempt_count: 1,
                claimed_at: "2026-07-30T20:00:00Z",
                created_at: "2026-07-30T19:59:00Z",
              })
            : "null",
        );
        return;
      }

      response.end("{}");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const config: BridgeConfig = {
    apiKey: "",
    apiToken: "bridge-secret",
    apiUrl: `http://127.0.0.1:${address.port}`,
    allowInsecureMock: false,
    bridgeId: "bridge-1",
    healthPort: 9100,
    maxClaim: 2,
    mockDelayMs: 0,
    mockFailureRate: 0,
    pollIntervalMs: 2_000,
    printerIds: ["MOCK-KITCHEN"],
    requestTimeoutMs: 5_000,
  };
  const client = new PrintBridgeApiClient(config);
  const [job] = await client.claimJobs();
  assert.ok(job);

  await client.markSent(job);
  await client.markPrinted(job, {
    externalReference: "bridge-1:mock-kitchen:job-1:1",
    printedAt: "2026-07-30T20:00:01Z",
    transport: "mock",
  });

  assert.deepEqual(
    requests.map(({ method, status }) => ({ method, status })),
    [
      { method: "POST", status: undefined },
      { method: "POST", status: undefined },
      { method: "PATCH", status: "SENT" },
      { method: "PATCH", status: "PRINTED" },
    ],
  );
  assert.equal(
    requests[0]?.path,
    "/api/v1/printing/bridge/claim?printer_codes=MOCK-KITCHEN",
  );
  assert.match(requests[2]?.idempotencyKey ?? "", /:sent$/);
  assert.match(requests[3]?.idempotencyKey ?? "", /:printed$/);
});
