let nextReportAt = 0;

/** Central same-origin reporting with a fixed schema; no error text or PII. */
export function reportIncident(kind: "react_boundary" | "unhandled_error" | "unhandled_rejection", digest?: string) {
  if (Date.now() < nextReportAt) return;
  nextReportAt = Date.now() + 6_000;
  const root = window.location.pathname.split("/")[1];
  const screen = ["admin", "waiter", "cashier"].includes(root) ? root : "other";
  void fetch("/api/backend/diagnostics/frontend-errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, screen, ...(/^[a-zA-Z0-9_-]{1,64}$/.test(digest ?? "") ? { digest } : {}) }),
    keepalive: true,
  }).catch(() => { /* Reporting failure must not trigger another report. */ });
}
