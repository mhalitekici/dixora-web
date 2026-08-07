"use client"

import {
  CheckCircle2,
  ChefHat,
  Clock3,
  RotateCcw,
  XCircle,
} from "lucide-react"

import type { PublicQrRequestDto } from "@/components/qr/types"
import { Button } from "@/components/ui/button"

export function QrRequestStatus({
  request,
  business,
  onBack,
}: {
  request: PublicQrRequestDto
  business: string
  onBack: () => void
}) {
  const approved = request.status === "APPROVED"
  const rejected = request.status === "REJECTED"
  const Icon = approved ? CheckCircle2 : rejected ? XCircle : Clock3

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-10">
      <section className="w-full max-w-md rounded-3xl border bg-card p-7 text-center shadow-sm sm:p-9">
        <div
          className={[
            "mx-auto flex size-16 items-center justify-center rounded-2xl",
            approved
              ? "bg-emerald-500/10 text-emerald-700"
              : rejected
                ? "bg-red-500/10 text-red-700"
                : "bg-amber-500/10 text-amber-700",
          ].join(" ")}
        >
          <Icon className="size-8" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {business}
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">
          {approved
            ? "Siparişiniz alındı"
            : rejected
              ? "Talebiniz kabul edilmedi"
              : "Talebiniz personele ulaştı"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {approved
            ? "Siparişiniz otomatik olarak onaylandı ve hazırlık akışına aktarıldı."
            : rejected
              ? "Detaylı bilgi için servis personelinden destek isteyebilirsiniz."
              : "Servis ekibi siparişinizi kontrol ediyor. Onaylandığında hazırlık başlayacak."}
        </p>

        <div className="mt-7 rounded-2xl bg-muted/60 p-4 text-left">
          <div className="flex items-center gap-3">
            <ChefHat className="size-5 text-brand" />
            <div>
              <p className="text-xs text-muted-foreground">Talep numarası</p>
              <p className="font-mono text-sm font-semibold">
                {request.reference.slice(2, 10).toUpperCase()}
              </p>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Bu ekran sunucunun son onaylı durumunu gösterir. Güncel bilgi için
          servis personeline başvurabilirsiniz.
        </p>

        <Button
          type="button"
          variant="outline"
          className="mt-6 h-11 w-full rounded-xl"
          onClick={onBack}
        >
          <RotateCcw />
          Menüye dön
        </Button>
      </section>
    </main>
  )
}
