"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Banknote, CreditCard, Loader2, LogOut, Repeat2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Shift = {
  id: string
  cashier_name: string | null
  user_display_name: string | null
  opening_cash: string
  cash_sales: string
  card_sales: string
  cash_refunds: string
  expected_cash: string
  reported_card_total: string | null
  card_variance: string | null
  opened_at: string
}

const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" })
const asMoney = (value: string) => value.replace(",", ".")

function Difference({ value }: { value: number }) {
  const state = value === 0 ? "TAM" : value < 0 ? "EKSİK" : "FAZLA"
  return <span className={cn("rounded-lg px-2.5 py-1 text-xs font-bold", value === 0 ? "bg-emerald-500/10 text-emerald-700" : value < 0 ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700")}>{state} · {value > 0 ? "+" : ""}{currency.format(value)}</span>
}

export function CashierShiftPage() {
  const client = useQueryClient()
  const [mode, setMode] = useState<"close" | "handoff">("close")
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [counted, setCounted] = useState("")
  const [reportedCard, setReportedCard] = useState("")
  const [note, setNote] = useState("")
  const [nextUsername, setNextUsername] = useState("")
  const [nextPin, setNextPin] = useState("")
  const [nextOpening, setNextOpening] = useState("")
  const query = useQuery({ queryKey: ["shifts", "current"], queryFn: () => api.get<Shift | null>("shifts/current"), refetchInterval: 15_000 })
  const shift = query.data
  const difference = counted === "" || !shift ? null : Number(asMoney(counted)) - Number(shift.expected_cash)
  const cardDifference = reportedCard === "" || !shift ? null : Number(asMoney(reportedCard)) - Number(shift.card_sales)
  const close = useMutation({
    mutationFn: () => {
      if (!shift) throw new Error("Açık vardiya bulunamadı.")
      const credentials = { username: username.trim(), pin, closing_cash: asMoney(counted), reported_card_total: asMoney(reportedCard), note: note.trim() || null }
      return mode === "close"
        ? api.post<Shift>(`shifts/${shift.id}/close`, credentials)
        : api.post(`shifts/${shift.id}/handoff`, { ...credentials, next_username: nextUsername.trim(), next_pin: nextPin, next_opening_cash: asMoney(nextOpening) })
    },
    onSuccess: async () => { toast.success(mode === "close" ? "Vardiya kapatıldı." : "Vardiya yeni kasiyere devredildi."); await client.invalidateQueries({ queryKey: ["shifts"] }) },
    onError: (error) => toast.error(error instanceof Error ? error.message : "İşlem tamamlanamadı."),
  })
  if (query.isLoading) return <div className="flex min-h-80 items-center justify-center"><Loader2 className="animate-spin" /><span className="sr-only">Yükleniyor</span></div>
  if (!shift) return <div className="p-6"><PageHeader eyebrow="Kasa" title="Açık vardiya yok" description="Kasiyer çalışma alanından yeni vardiya açın." icon={Banknote} /></div>
  const valid = username.trim().length >= 2 && pin.length >= 4 && counted !== "" && reportedCard !== "" && (mode === "close" || (nextUsername.trim().length >= 2 && nextPin.length >= 4 && nextOpening !== ""))
  return <div className="min-h-full bg-muted/20 p-4 sm:p-6">
    <PageHeader eyebrow="Kasa" title="Vardiya kapanış ve devir" description={`${shift.cashier_name ?? shift.user_display_name ?? "Kasiyer"} · ${new Date(shift.opened_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} başlangıç`} icon={Banknote} />
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <Card><CardHeader><CardTitle>Kasa mutabakatı</CardTitle><CardDescription>Kart tahsilatları beklenen nakde eklenmez.</CardDescription></CardHeader><CardContent className="space-y-3">
        <Row label="Açılış" value={shift.opening_cash} /><Row label="Nakit satış" value={shift.cash_sales} plus /><Row label="Nakit iade" value={shift.cash_refunds} minus /><div className="border-t pt-3"><Row label="Beklenen nakit" value={shift.expected_cash} strong /></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><Banknote className="size-4" />Nakit kasa<ArrowRight className="size-3" /><CreditCard className="size-4" />Kart toplamı: {currency.format(Number(shift.card_sales))}</div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Sayım ve yetkilendirme</CardTitle><CardDescription>Kapanışı vardiya kasiyeri veya yetkili müdür PIN’iyle onaylar.</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2"><Button type="button" variant={mode === "close" ? "default" : "outline"} onClick={() => setMode("close")}><LogOut />Kapat</Button><Button type="button" variant={mode === "handoff" ? "default" : "outline"} onClick={() => setMode("handoff")}><Repeat2 />Devret</Button></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Kullanıcı adı" value={username} onChange={setUsername} autoComplete="username" /><Field label="PIN" value={pin} onChange={setPin} type="password" inputMode="numeric" /></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Sayılmış kapanış nakdi" value={counted} onChange={setCounted} inputMode="decimal" placeholder="0,00" /><Field label="POS / Z kart toplamı" value={reportedCard} onChange={setReportedCard} inputMode="decimal" placeholder="0,00" /></div>
        <p className="text-xs text-muted-foreground">Kart toplamını fiziksel POS veya Z raporundan manuel girin.</p>
        {difference !== null && cardDifference !== null && Number.isFinite(difference) && Number.isFinite(cardDifference) ? <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Nakit farkı</span><Difference value={difference} /></div><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">Kart farkı</span><Difference value={cardDifference} /></div></div> : null}
        {mode === "handoff" ? <div className="space-y-3 rounded-2xl border bg-muted/25 p-3"><p className="text-sm font-semibold">Devralan çalışan</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Kullanıcı adı" value={nextUsername} onChange={setNextUsername} autoComplete="off" /><Field label="PIN" value={nextPin} onChange={setNextPin} type="password" inputMode="numeric" /></div><Field label="Yeni açılış nakdi" value={nextOpening} onChange={setNextOpening} inputMode="decimal" placeholder="0,00" /><p className="text-xs text-muted-foreground">Önceki sayım otomatik taşınmaz; gerçek açılış tutarını girin.</p></div> : null}
        <Field label="Kapanış notu (opsiyonel)" value={note} onChange={setNote} />
        <Button className="h-12 w-full" disabled={!valid || close.isPending} onClick={() => close.mutate()}>{close.isPending ? <Loader2 className="animate-spin" /> : mode === "close" ? <LogOut /> : <Repeat2 />}{mode === "close" ? "Özeti Onayla ve Kapat" : "Sayımı Onayla ve Devret"}</Button>
      </CardContent></Card>
    </div>
  </div>
}

function Row({ label, value, plus, minus, strong }: { label: string; value: string; plus?: boolean; minus?: boolean; strong?: boolean }) { return <div className={cn("flex items-center justify-between text-sm", strong && "text-base font-bold")}><span>{label}</span><span className="tabular-nums">{plus ? "+ " : minus ? "− " : ""}{currency.format(Number(value))}</span></div> }
function Field({ label, value, onChange, ...props }: { label: string; value: string; onChange: (value: string) => void } & Omit<React.ComponentProps<typeof Input>, "value" | "onChange">) { const id = `shift-${label.toLowerCase().replaceAll(" ", "-")}`; return <div><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-11" {...props} /></div> }
