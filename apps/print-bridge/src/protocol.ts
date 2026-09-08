import type { PrintJobClaim } from "@dixora/shared-types";

export const PRINTING_API = Object.freeze({
  claim: (printerCodes: readonly string[], branchId?: string) => {
    const parameters = new URLSearchParams();
    if (printerCodes.length > 0) {
      parameters.set("printer_codes", printerCodes.join(","));
    }
    if (branchId) {
      parameters.set("branch_id", branchId);
    }
    const query = parameters.toString();
    return query
      ? `/api/v1/printing/bridge/claim?${query}`
      : "/api/v1/printing/bridge/claim";
  },
  update: (jobId: string) => `/api/v1/printing/bridge/jobs/${jobId}`,
  heartbeat: "/api/v1/printing/bridge/heartbeat",
  enroll: "/api/v1/printing/bridge/enroll",
});

export interface BridgeUpdateRequest {
  attempt_count: number;
  error: string | null;
  manual_retry_required?: boolean;
  result?: {
    external_reference: string;
    printed_at: string;
    transport: "mock" | "windows" | "macos";
  };
  status: "SENT" | "PRINTED" | "FAILED";
}

export interface MalformedClaimReference {
  attemptCount: number;
  id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readAliasedValue(
  record: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
): unknown {
  return record[snakeCaseKey] ?? record[camelCaseKey];
}

function requireString(
  record: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey = camelCaseKey,
): string {
  const value = readAliasedValue(record, camelCaseKey, snakeCaseKey);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Print job field '${snakeCaseKey}' must be a non-empty string`,
    );
  }
  return value;
}

export function parseClaimedJobs(payload: unknown): PrintJobClaim[] {
  const candidateItems =
    isRecord(payload) && Array.isArray(payload.items) ? payload.items : payload;

  if (!Array.isArray(candidateItems)) {
    throw new Error(
      "Print job claim response must be an array or an items envelope",
    );
  }

  return candidateItems.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`Print job at index ${index} must be an object`);
    }

    const jobPayload = isRecord(candidate.payload)
      ? candidate.payload
      : candidate;
    const isTestPrint =
      readOptionalString(jobPayload, "documentType", "document_type") ===
      "PRINTER_TEST";
    const contentType =
      readAliasedValue(jobPayload, "contentType", "content_type") ??
      "application/vnd.dixora.receipt+json";
    const copies = readAliasedValue(jobPayload, "copies", "copies") ?? 1;
    const documentValue =
      readAliasedValue(jobPayload, "document", "document") ??
      createLegacyDocument(candidate, jobPayload);

    if (contentType !== "application/vnd.dixora.receipt+json") {
      throw new Error(
        `Print job at index ${index} has an unsupported content type`,
      );
    }
    if (
      typeof copies !== "number" ||
      !Number.isSafeInteger(copies) ||
      copies < 1 ||
      copies > 10
    ) {
      throw new Error(`Print job at index ${index} has an invalid copy count`);
    }
    if (!isRecord(documentValue) || !Array.isArray(documentValue.lines)) {
      throw new Error(
        `Print job at index ${index} has an invalid receipt document`,
      );
    }

    const document = normalizeDocument(documentValue, index);
    const kind = readAliasedValue(candidate, "kind", "kind");
    const isReprint =
      readAliasedValue(jobPayload, "isReprint", "is_reprint") === true ||
      kind === "REPRINT";

    const localPrinterName = readNullableString(
      candidate,
      "localPrinterName",
      "local_printer_name",
    );

    return {
      id: requireString(candidate, "id"),
      tenantId: requireString(candidate, "tenantId", "tenant_id"),
      branchId: requireString(candidate, "branchId", "branch_id"),
      printerDeviceId:
        readNullableString(candidate, "printerCode", "printer_code") ??
        requireString(candidate, "printerDeviceId", "printer_device_id"),
      ...(localPrinterName ? { localPrinterName } : {}),
      preparationStationId: readNullableString(
        candidate,
        "preparationStationId",
        "preparation_station_id",
      ),
      orderId: isTestPrint
        ? readNullableString(candidate, "orderId", "order_id")
        : requireString(candidate, "orderId", "order_id"),
      kitchenTicketId: readNullableString(
        candidate,
        "kitchenTicketId",
        "kitchen_ticket_id",
      ),
      contentType,
      document,
      copies,
      isReprint,
      isTestPrint,
      attemptCount: readNonNegativeInteger(
        candidate,
        "attemptCount",
        "attempt_count",
      ),
      claimedAt:
        readOptionalString(candidate, "claimedAt", "claimed_at") ??
        requireString(candidate, "createdAt", "created_at"),
    };
  });
}

export function malformedClaimReference(
  payload: unknown,
): MalformedClaimReference | null {
  const candidate =
    isRecord(payload) && Array.isArray(payload.items)
      ? payload.items[0]
      : payload;
  if (!isRecord(candidate)) return null;
  const id = readOptionalString(candidate, "id");
  const attemptCount = readAliasedValue(
    candidate,
    "attemptCount",
    "attempt_count",
  );
  if (
    !id ||
    typeof attemptCount !== "number" ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1
  ) {
    return null;
  }
  return { id, attemptCount };
}

function createLegacyDocument(
  job: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const items = payload.items;
  const lines = Array.isArray(items)
    ? items.map((item) => {
        if (!isRecord(item)) {
          throw new Error("Legacy print payload contains an invalid item");
        }
        return {
          name: requireString(item, "name"),
          quantity: requireString(item, "quantity"),
          ...(readOptionalString(item, "note") !== undefined
            ? { note: readOptionalString(item, "note") }
            : {}),
        };
      })
    : [];

  return {
    title: "PREPARATION",
    branch_name:
      readOptionalString(job, "branchName", "branch_name") ??
      requireString(job, "branchId", "branch_id"),
    station_name:
      readOptionalString(
        job,
        "preparationStationId",
        "preparation_station_id",
      ) ?? "Unassigned station",
    order_number:
      readOptionalString(job, "orderId", "order_id") ??
      readOptionalString(payload, "orderId", "order_id") ??
      "Unknown order",
    submitted_at:
      readOptionalString(job, "claimedAt", "claimed_at") ??
      readOptionalString(job, "createdAt", "created_at") ??
      new Date().toISOString(),
    lines,
  };
}

function readNullableString(
  record: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
): string | null {
  const value = readAliasedValue(record, camelCaseKey, snakeCaseKey);
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Print job field '${snakeCaseKey}' must be a string or null`,
    );
  }
  return value;
}

function readNonNegativeInteger(
  record: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey: string,
): number {
  const value = readAliasedValue(record, camelCaseKey, snakeCaseKey);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Print job field '${snakeCaseKey}' must be a non-negative integer`,
    );
  }
  return value;
}

function normalizeDocument(
  document: Record<string, unknown>,
  jobIndex: number,
): PrintJobClaim["document"] {
  const lines = document.lines;
  if (!Array.isArray(lines)) {
    throw new Error(`Print job at index ${jobIndex} has invalid receipt lines`);
  }

  const tableName = readOptionalString(document, "tableName", "table_name");
  const businessName = readOptionalString(
    document,
    "businessName",
    "business_name",
  );
  const waiterName = readOptionalString(document, "waiterName", "waiter_name");
  const currency = readOptionalString(document, "currency");
  const footer =
    Array.isArray(document.footer) &&
    document.footer.every((item) => typeof item === "string")
      ? document.footer
      : undefined;

  return {
    title: requireString(document, "title"),
    ...(businessName !== undefined ? { businessName } : {}),
    branchName: requireString(document, "branchName", "branch_name"),
    stationName: requireString(document, "stationName", "station_name"),
    orderNumber: requireString(document, "orderNumber", "order_number"),
    ...(tableName !== undefined ? { tableName } : {}),
    ...(waiterName !== undefined ? { waiterName } : {}),
    submittedAt: requireString(document, "submittedAt", "submitted_at"),
    ...(currency !== undefined ? { currency } : {}),
    lines: lines.map((line, lineIndex) => {
      if (!isRecord(line)) {
        throw new Error(
          `Receipt line ${lineIndex} in job ${jobIndex} must be an object`,
        );
      }
      const modifiers = line.modifiers;
      const footerSafeModifiers =
        modifiers === undefined
          ? undefined
          : Array.isArray(modifiers) &&
              modifiers.every((modifier) => typeof modifier === "string")
            ? modifiers
            : null;
      if (footerSafeModifiers === null) {
        throw new Error(
          `Receipt line ${lineIndex} in job ${jobIndex} has invalid modifiers`,
        );
      }
      const unitPrice = readOptionalString(line, "unitPrice", "unit_price");
      const lineTotal = readOptionalString(line, "lineTotal", "line_total");
      const note = readOptionalString(line, "note");
      const adjustmentLabel = readOptionalString(
        line,
        "adjustmentLabel",
        "adjustment_label",
      );
      const complimentary =
        readAliasedValue(line, "complimentary", "complimentary") === true;

      return {
        name: requireString(line, "name"),
        quantity: requireString(line, "quantity"),
        ...(unitPrice !== undefined ? { unitPrice } : {}),
        ...(lineTotal !== undefined ? { lineTotal } : {}),
        ...(footerSafeModifiers !== undefined
          ? { modifiers: footerSafeModifiers }
          : {}),
        ...(note !== undefined ? { note } : {}),
        ...(complimentary ? { complimentary: true } : {}),
        ...(adjustmentLabel !== undefined ? { adjustmentLabel } : {}),
      };
    }),
    ...(footer !== undefined ? { footer } : {}),
  };
}

function readOptionalString(
  record: Record<string, unknown>,
  camelCaseKey: string,
  snakeCaseKey = camelCaseKey,
): string | undefined {
  const value = readAliasedValue(record, camelCaseKey, snakeCaseKey);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Field '${snakeCaseKey}' must be a string`);
  }
  return value;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return "Unknown print transport error";
}
