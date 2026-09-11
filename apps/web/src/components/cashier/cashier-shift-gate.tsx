"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowLeft, Loader2, LockKeyhole, Wallet } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { BrandLogo } from "@/components/brand/brand-logo"
import { CashierWorkspace } from "@/components/cashier/cashier-workspace"
import { EmptyState } from "@/components/shared/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type CashierShift = { id: string; status: string }
type Employee = { user_id: string; username: string; display_name: string }

const messages: Record<string, string> = {
  shift_already_open: "Bu kullanıcı için açık vardiya var. Mevcut vardiyadan devam edin.",
  cashier_shift_already_open: "Bu çalışanın zaten açık vardiyası var. Önce mevcut vardiyayı kapatın.",
  next_cashier_shift_already_open: "Devralan çalışanın açık vardiyası var. Devirden önce bu vardiyayı kapatın.",
  invalid_credentials: "Kullanıcı adı veya PIN hatalı.",
  staff_branch_forbidden: "Bu çalışan bu şubeye atanmamış.",
  staff_permission_required: "Bu çalışanın kasa vardiyası yetkisi yok.",
  login_rate_limited: "Çok fazla hatalı deneme. Lütfen bir süre bekleyin.",
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  const payload = (await response.json().catch(() => null)) as
    | T
    | { detail?: string; error?: { message?: string; code?: string } }
    | null
  if (!response.ok) {
    const error = payload as { detail?: string; error?: { message?: string; code?: string } } | null
    const code = error?.error?.code
    throw new Error((code && messages[code]) ?? error?.error?.message ?? error?.detail ?? "İşlem tamamlanamadı.")
  }
  return payload as T
}

export function CashierShiftGate() {
  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => api<CashierShift | null>("/shifts/current"),
  })
  if (shiftQuery.isLoading) {
    return <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-muted/25" role="status"><Loader2 className="size-7 animate-spin text-brand" /><span className="sr-only">Vardiya durumu kontrol ediliyor</span></div>
  }
  if (shiftQuery.isError) {
    return <div className="min-h-[calc(100dvh-4rem)] bg-muted/25 p-4 sm:p-6"><EmptyState title="Vardiya bilgisi alınamadı" description="Bağlantınızı kontrol edip yeniden deneyin." icon={AlertTriangle} action={<Button variant="outline" onClick={() => void shiftQuery.refetch()}>Yeniden dene</Button>} /></div>
  }
  return shiftQuery.data ? <CashierWorkspace /> : <OpenShiftScreen onOpened={() => void shiftQuery.refetch()} />
}

function OpenShiftScreen({ onOpened }: { onOpened: () => void }) {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState("")
  const [pin, setPin] = useState("")
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [openingCash, setOpeningCash] = useState("")
  const [note, setNote] = useState("")

  const verify = useMutation({
    mutationFn: () => api<Employee>("/shifts/verify", { method: "POST", body: JSON.stringify({ username: username.trim(), pin }) }),
    onSuccess: setEmployee,
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kimlik doğrulanamadı."),
  })
  const open = useMutation({
    mutationFn: () => api<CashierShift>("/shifts/open", { method: "POST", body: JSON.stringify({ username: username.trim(), pin, opening_cash: openingCash.replace(",", "."), note: note.trim() || null }) }),
    onSuccess: async () => { toast.success("Vardiya açıldı"); await queryClient.invalidateQueries({ queryKey: ["shifts"] }); onOpened() },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Vardiya açılamadı."),
  })
  const moneyValid = openingCash.trim() !== "" && !Number.isNaN(Number(openingCash.replace(",", ".")))

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center bg-muted/25 p-4">
      <div className="w-full max-w-md rounded-3xl border bg-card p-6 text-center shadow-sm sm:p-8">
        <BrandLogo className="mx-auto h-9" />
        <h1 className="mt-5 text-lg font-semibold">Dixora Kasa</h1>
        <p className="mt-1 text-sm text-muted-foreground">{employee ? "Açılış kasasını sayın" : "Çalışan kimliğinizi doğrulayın"}</p>
        <form className="mt-6 space-y-4 text-left" onSubmit={(event) => {
          event.preventDefault()
          if (employee) open.mutate()
          else verify.mutate()
        }}>
          {!employee ? <>
            <div><Label htmlFor="shift-username">Kullanıcı adı</Label><Input id="shift-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ahmet.yilmaz" className="mt-1.5 h-12 rounded-xl" autoFocus /></div>
            <div><Label htmlFor="shift-pin">PIN</Label><Input id="shift-pin" type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="••••" className="mt-1.5 h-12 rounded-xl text-lg tracking-[0.25em]" /></div>
          </> : <>
            <div className="rounded-2xl border bg-muted/35 p-3"><p className="text-xs font-medium text-muted-foreground">Kasiyer</p><p className="font-semibold">{employee.display_name}</p></div>
            <div><Label htmlFor="shift-opening-cash">Açılış nakdi</Label><Input id="shift-opening-cash" inputMode="decimal" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} placeholder="0,00" className="mt-1.5 h-14 rounded-xl text-xl font-semibold tabular-nums" autoFocus /><p className="mt-1.5 text-xs text-muted-foreground">0 TL geçerli bir açılış tutarıdır.</p></div>
            <div><Label htmlFor="shift-opening-note">Not (opsiyonel)</Label><Input id="shift-opening-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Devir teslim notu" className="mt-1.5 h-11 rounded-xl" /></div>
          </>}
          <Button type="submit" className="h-12 w-full rounded-xl text-base" disabled={employee ? !moneyValid || open.isPending : username.trim().length < 2 || pin.length < 4 || verify.isPending}>
            {open.isPending || verify.isPending ? <Loader2 className="animate-spin" /> : employee ? <Wallet /> : <LockKeyhole />}{employee ? "Vardiyayı Aç" : "Devam"}
          </Button>
          {employee ? <Button type="button" variant="ghost" className="w-full" onClick={() => { setEmployee(null); setPin("") }}><ArrowLeft />Başka çalışan</Button> : null}
        </form>
      </div>
    </div>
  )
}
