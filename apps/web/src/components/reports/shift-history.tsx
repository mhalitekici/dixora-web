"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Banknote, CalendarCheck2, ChevronDown, CreditCard, Loader2, MonitorDot } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { EmptyState } from "@/components/shared/empty-state"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Shift = { id: string; user_display_name: string | null; cashier_name: string | null; closed_by_display_name: string | null; business_date: string; status: string; opening_cash: string; closing_cash: string | null; cash_sales: string; card_sales: string; cash_refunds: string; card_refunds: string; expected_cash: string; total_sales: string; cash_variance: string | null; reported_card_total: string | null; card_variance: string | null; opened_at: string; closed_at: string | null; opening_note: string | null; closing_note: string | null }
type Day = { id: string; business_date: string; closed_by_display_name: string | null; closed_at: string; system_cash_total: string; system_card_total: string; expected_cash: string; counted_cash: string; reported_card_total: string; cash_difference: string; card_difference: string; sales_total: string; cash_refunds: string; card_refunds: string; discounts_total: string; complimentary_total: string; service_charge_total: string; receipt_count: number; note: string | null }
type Preview = Omit<Day, "id" | "closed_by_display_name" | "closed_at" | "counted_cash" | "reported_card_total" | "cash_difference" | "card_difference" | "note"> & { opening_cash: string; open_shift_count: number }
const money = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" })
const m = (value: string | number) => money.format(Number(value))

function State({ value }: { value: number }) { const label = value === 0 ? "TAM" : value < 0 ? "EKSİK" : "FAZLA"; return <span className={cn("rounded-md px-2 py-1 text-xs font-bold", value === 0 ? "bg-emerald-500/10 text-emerald-700" : value < 0 ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700")}>{label} · {value > 0 ? "+" : ""}{m(value)}</span> }

export function ShiftHistory() {
  const client = useQueryClient()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [status, setStatus] = useState("")
  const [employee, setEmployee] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [counted, setCounted] = useState("")
  const [cardZ, setCardZ] = useState("")
  const [note, setNote] = useState("")
  const [closingShiftId, setClosingShiftId] = useState<string | null>(null)
  const search = { limit: 100, date_from: from || undefined, date_to: to || undefined, status: status || undefined }
  const shifts = useQuery({ queryKey: ["shifts", "history", search], queryFn: ({ signal }) => api.get<Shift[]>("shifts/history", { search, signal }) })
  const days = useQuery({ queryKey: ["shifts", "day-history", from, to], queryFn: ({ signal }) => api.get<Day[]>("shifts/day/history", { search: { limit: 100, date_from: from || undefined, date_to: to || undefined }, signal }) })
  const preview = useQuery({ queryKey: ["shifts", "day-preview"], queryFn: ({ signal }) => api.get<Preview>("shifts/day/preview", { signal }), retry: false })
  const openShifts = useQuery({ queryKey: ["shifts", "open"], queryFn: ({ signal }) => api.get<Shift[]>("shifts/history", { search: { limit: 100, status: "OPEN" }, signal }) })
  const filtered = useMemo(() => (shifts.data ?? []).filter((row) => (row.cashier_name ?? row.user_display_name ?? "").toLocaleLowerCase("tr").includes(employee.toLocaleLowerCase("tr"))), [shifts.data, employee])
  const openRows = (openShifts.data ?? []).filter((shift) => shift.status === "OPEN")
  const closingShift = openRows.find((shift) => shift.id === closingShiftId) ?? (openRows.length === 1 ? openRows[0] : null)
  const expectedCash = closingShift?.expected_cash ?? preview.data?.expected_cash
  const expectedCard = closingShift?.card_sales ?? preview.data?.system_card_total
  const cashDifference = expectedCash && counted !== "" ? Number(counted.replace(",", ".")) - Number(expectedCash) : null
  const cardDifference = expectedCard && cardZ !== "" ? Number(cardZ.replace(",", ".")) - Number(expectedCard) : null
  const closeShift = useMutation({
    mutationFn: () => {
      if (!closingShift) throw new Error("Kapatılacak vardiyayı seçin.")
      return api.post<Shift>(`shifts/${closingShift.id}/close`, { username: username.trim(), pin, closing_cash: counted.replace(",", "."), reported_card_total: cardZ.replace(",", "."), note: note.trim() || null })
    },
    onSuccess: async () => {
      toast.success("Açık vardiya kapatıldı. Şimdi gün sonunu verebilirsiniz.")
      setClosingShiftId(null)
      setPin("")
      setCounted("")
      setCardZ("")
      setNote("")
      await client.invalidateQueries({ queryKey: ["shifts"] })
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Vardiya kapatılamadı."),
  })
  const closeDay = useMutation({
    mutationFn: () => api.post<Day>("shifts/business-day-close", { username: username.trim(), pin, counted_cash: counted.replace(",", "."), reported_card_total: cardZ.replace(",", "."), note: note.trim() || null }),
    onSuccess: async () => { toast.success("İşletme günü kapatıldı."); setPin(""); await client.invalidateQueries({ queryKey: ["shifts"] }) },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Gün sonu tamamlanamadı."),
  })
  return <div className="min-h-full space-y-5 bg-muted/20 p-4 sm:p-6">
    <PageHeader eyebrow="Raporlar" title="Vardiya ve gün sonu" description="Çalışan bazlı kasa sayımları ile şube iş günü mutabakatını ayrı izleyin." icon={MonitorDot} />
    <Card><CardContent className="grid gap-3 pt-6 sm:grid-cols-4"><Field label="Başlangıç" type="date" value={from} onChange={setFrom} /><Field label="Bitiş" type="date" value={to} onChange={setTo} /><Field label="Çalışan" value={employee} onChange={setEmployee} placeholder="Ada göre filtrele" /><div><Label htmlFor="shift-status">Durum</Label><select id="shift-status" value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Tümü</option><option value="OPEN">Açık</option><option value="CLOSED">Kapalı</option></select></div></CardContent></Card>
    <section><h2 className="mb-3 text-base font-semibold">Vardiya raporları</h2>{shifts.isLoading ? <Loader2 className="animate-spin" /> : filtered.length === 0 ? <EmptyState title="Vardiya kaydı yok" description="Seçilen filtrelerde kayıt bulunamadı." icon={MonitorDot} /> : <div className="grid gap-3 lg:grid-cols-2">{filtered.map((shift) => { const variance = Number(shift.cash_variance ?? 0); return <Card key={shift.id}><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-base">{shift.cashier_name ?? shift.user_display_name ?? "Kasiyer"}</CardTitle><CardDescription>{shift.business_date} · {new Date(shift.opened_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} → {shift.closed_at ? new Date(shift.closed_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "Açık"}</CardDescription></div>{shift.status === "OPEN" ? <span className="rounded-md bg-emerald-500/10 px-2 py-1 text-xs font-bold text-emerald-700">AÇIK</span> : <State value={variance} />}</div></CardHeader><CardContent><div className="grid grid-cols-3 gap-2"><Metric label="Açılış" value={shift.opening_cash} /><Metric label="Beklenen" value={shift.expected_cash} /><Metric label="Sayılan" value={shift.closing_cash ?? "0"} /></div><Button variant="ghost" className="mt-2 w-full" onClick={() => setExpanded(expanded === shift.id ? null : shift.id)}>Detayı göster <ChevronDown className={cn("transition", expanded === shift.id && "rotate-180")} /></Button>{expanded === shift.id ? <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-sm"><Detail label="Nakit satış" value={m(shift.cash_sales)} /><Detail label="Kart satış" value={m(shift.card_sales)} /><Detail label="POS / Z kart" value={shift.reported_card_total == null ? "—" : m(shift.reported_card_total)} /><Detail label="Kart farkı" value={shift.card_variance == null ? "—" : m(shift.card_variance)} /><Detail label="Nakit iade" value={m(shift.cash_refunds)} /><Detail label="Kart iade" value={m(shift.card_refunds)} /><Detail label="Kapatan" value={shift.closed_by_display_name ?? "—"} /><Detail label="Not" value={shift.closing_note ?? shift.opening_note ?? "—"} /></div> : null}</CardContent></Card> })}</div>}</section>
    {preview.data ? <Card className="border-brand/25"><CardHeader><CardTitle className="flex items-center gap-2"><CalendarCheck2 className="size-5" />Gün sonu · {preview.data.business_date}</CardTitle><CardDescription>{openRows.length > 0 ? "Önce açık vardiyayı kapatın; ardından gün sonu mutabakatını tamamlayın." : "POS / Z kart toplamı fiziksel cihaz raporundan manuel girilir."}</CardDescription></CardHeader><CardContent className="grid gap-5 lg:grid-cols-2"><div className="space-y-2"><Detail label="Sistem nakit" value={m(preview.data.system_cash_total)} /><Detail label="Sistem kart" value={m(preview.data.system_card_total)} /><Detail label="Beklenen kasa" value={m(preview.data.expected_cash)} /><Detail label="Fiş sayısı" value={String(preview.data.receipt_count)} />{preview.data.open_shift_count > 0 ? <div className="space-y-2 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3"><p className="text-sm font-medium text-amber-900">{preview.data.open_shift_count} açık vardiya var. Aşağıdan vardiyayı seçip sağdaki sayım bilgileriyle kapatın.</p>{openRows.map((shift) => <Button key={shift.id} type="button" size="sm" variant={closingShift?.id === shift.id ? "default" : "outline"} className="w-full justify-between" onClick={() => setClosingShiftId(shift.id)}><span>{shift.cashier_name ?? shift.user_display_name ?? "Kasiyer"}</span><span>{m(shift.expected_cash)}</span></Button>)}</div> : null}</div><div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Yetkili kullanıcı adı" value={username} onChange={setUsername} /><Field label="PIN" type="password" inputMode="numeric" value={pin} onChange={setPin} /></div><div className="grid gap-3 sm:grid-cols-2"><Field label={closingShift ? "Vardiya sayılan nakdi" : "Sayılan nakit"} inputMode="decimal" value={counted} onChange={setCounted} /><Field label={closingShift ? "Vardiya POS / Z kart toplamı" : "POS / Z kart toplamı"} inputMode="decimal" value={cardZ} onChange={setCardZ} /></div><p className="text-xs text-muted-foreground">{closingShift ? `${closingShift.cashier_name ?? closingShift.user_display_name ?? "Kasiyer"} vardiyasının fiziksel kasa ve POS/Z toplamlarını girin.` : "Fiziksel POS veya kasa raporundaki toplamı girin."}</p>{cashDifference !== null && cardDifference !== null && Number.isFinite(cashDifference) && Number.isFinite(cardDifference) ? <div className="flex flex-wrap gap-2 rounded-xl border p-3"><span className="text-xs font-medium text-muted-foreground">Nakit</span><State value={cashDifference} /><span className="ml-2 text-xs font-medium text-muted-foreground">Kart</span><State value={cardDifference} /></div> : null}<Field label="Not (opsiyonel)" value={note} onChange={setNote} /><Button className="h-11 w-full" disabled={username.length < 2 || pin.length < 4 || counted === "" || cardZ === "" || closeDay.isPending || closeShift.isPending || (preview.data.open_shift_count > 0 && !closingShift)} onClick={() => preview.data.open_shift_count > 0 ? closeShift.mutate() : closeDay.mutate()}>{closeDay.isPending || closeShift.isPending ? <Loader2 className="animate-spin" /> : <CalendarCheck2 />}{closingShift ? `${closingShift.cashier_name ?? closingShift.user_display_name ?? "Kasiyer"} Vardiyasını Kapat` : "Karşılaştırmayı Onayla ve Kapat"}</Button></div></CardContent></Card> : null}
    <section><h2 className="mb-3 text-base font-semibold">İşletme günü kayıtları</h2><div className="grid gap-3 lg:grid-cols-2">{(days.data ?? []).map((day) => <Card key={day.id}><CardHeader><div className="flex items-start justify-between"><div><CardTitle className="text-base">{day.business_date}</CardTitle><CardDescription>{day.closed_by_display_name ?? "Yetkili"} · {new Date(day.closed_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}</CardDescription></div><CalendarCheck2 className="size-5 text-muted-foreground" /></div></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-2"><Metric label="Nakit / sayılan" value={`${m(day.system_cash_total)} / ${m(day.counted_cash)}`} icon={<Banknote />} /><Metric label="Kart / Z" value={`${m(day.system_card_total)} / ${m(day.reported_card_total)}`} icon={<CreditCard />} /></div><div className="flex flex-wrap gap-2"><State value={Number(day.cash_difference)} /><State value={Number(day.card_difference)} /></div><p className="text-xs text-muted-foreground">Toplam {m(day.sales_total)} · {day.receipt_count} fiş · İkram {m(day.complimentary_total)} · İade {m(Number(day.cash_refunds) + Number(day.card_refunds))} · İndirim {m(day.discounts_total)} · Servis {m(day.service_charge_total)}</p></CardContent></Card>)}</div></section>
  </div>
}

function Field({ label, value, onChange, ...props }: { label: string; value: string; onChange: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) { const id = `report-${label.toLowerCase().replaceAll(" ", "-")}`; return <div><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5" {...props} /></div> }
function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) { return <div className="rounded-xl bg-muted/45 p-3"><p className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</p><p className="mt-1 text-sm font-bold tabular-nums">{value.includes("₺") ? value : m(value)}</p></div> }
function Detail({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium tabular-nums">{value}</span></div> }
