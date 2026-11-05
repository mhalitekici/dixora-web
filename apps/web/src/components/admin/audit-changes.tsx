const fieldLabels: Record<string, string> = {
  name: "Ad",
  display_name: "Çalışan adı",
  amount: "Tutar",
  method: "Ödeme yöntemi",
  status: "Durum",
  is_active: "Aktiflik",
  quantity: "Adet",
  selling_price: "Satış fiyatı",
  purchase_price: "Alış fiyatı",
  opening_cash: "Açılış nakdi",
  closing_cash: "Sayılan nakit",
  expected_cash: "Beklenen kasa",
  cash_variance: "Kasa farkı",
  card_variance: "POS farkı",
  permissions: "Yetkiler",
  role: "Rol",
  panel: "Panel",
  mode: "Çalışma modu",
  reason: "Gerekçe",
  note: "Not",
  local_printer_name: "Yerel yazıcı",
  operator_confirmed: "Operatör onayı",
  branch_ids: "Şube erişimleri",
  operational_profile: "Çalışma profili",
  result: "Sonuç",
};
const secret =
  /password|passwd|credential|authorization|cookie|secret|token|auth_session|api[_-]?key|(^|_)pin($|_)|customer|email|phone|address/i;
export function redactAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAudit);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      secret.test(key) ? "[Gizlendi]" : redactAudit(item),
    ]),
  );
}
function text(value: unknown): string {
  if (value == null) return "Kayıt yok";
  if (value === true) return "Evet";
  if (value === false) return "Hayır";
  if (typeof value === "object") return JSON.stringify(value);
  return (
    (
      {
        CASH: "Nakit",
        CARD: "Kart",
        OPEN: "Açık",
        CLOSED: "Kapalı",
        support: "Destek",
        waiter: "Garson",
        cashier: "Kasiyer",
      } as Record<string, string>
    )[String(value)] ?? String(value)
  );
}
export function AuditChanges({
  previous,
  next,
}: {
  previous: unknown;
  next: unknown;
}) {
  const old = (redactAudit(previous) ?? {}) as Record<string, unknown>;
  const current = (redactAudit(next) ?? {}) as Record<string, unknown>;
  const keys = [
    ...new Set([...Object.keys(old), ...Object.keys(current)]),
  ].filter(
    (key) =>
      !secret.test(key) &&
      JSON.stringify(old[key]) !== JSON.stringify(current[key]),
  );
  if (!keys.length)
    return (
      <p className="text-sm text-muted-foreground">
        Alan değişikliği kaydedilmemiş.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="p-3">Alan</th>
            <th className="p-3">Önceki değer</th>
            <th className="p-3">Yeni değer</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-t align-top">
              <th scope="row" className="p-3 font-medium">
                {fieldLabels[key] ?? key.replaceAll("_", " ")}
              </th>
              <td className="max-w-64 break-words p-3 text-muted-foreground">
                {text(old[key])}
              </td>
              <td className="max-w-64 break-words p-3">{text(current[key])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
