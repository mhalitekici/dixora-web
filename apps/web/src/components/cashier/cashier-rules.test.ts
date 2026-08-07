import { describe, expect, it } from "vitest";

import {
  canCloseTableSession,
  selectCurrentTableOrder,
} from "./cashier-rules";

const table = { id: "table-1", name: "A1", state: "CLEANING" };

describe("cashier table closing rules", () => {
  it("keeps a paid order visible while its table session awaits explicit close", () => {
    const paid = {
      id: "paid-order",
      table_id: table.id,
      table_session_id: "session-1",
      status: "PAID",
    };

    expect(selectCurrentTableOrder([paid], table)).toBe(paid);
    expect(canCloseTableSession(paid, table, 0)).toBe(true);
  });

  it("does not surface historical paid orders after the table is available", () => {
    const paid = {
      table_id: table.id,
      table_session_id: "session-1",
      status: "PAID",
    };

    expect(
      selectCurrentTableOrder([paid], { ...table, state: "AVAILABLE" }),
    ).toBeNull();
  });

  it("blocks closing an open or financially unsettled order", () => {
    const open = {
      table_id: table.id,
      table_session_id: "session-1",
      status: "SERVED",
    };
    const underpaid = { ...open, status: "PAID" };

    expect(canCloseTableSession(open, table, 0)).toBe(false);
    expect(canCloseTableSession(underpaid, table, 25)).toBe(false);
  });

  it("prefers a current open order over historical terminal orders", () => {
    const paid = {
      id: "old",
      table_id: table.id,
      table_session_id: "old-session",
      status: "PAID",
    };
    const open = {
      id: "current",
      table_id: table.id,
      table_session_id: "new-session",
      status: "ACCEPTED",
    };

    expect(selectCurrentTableOrder([paid, open], table)).toBe(open);
  });
});

