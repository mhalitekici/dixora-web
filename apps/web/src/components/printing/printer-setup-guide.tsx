import { Check, Copy, Laptop, Printer } from "lucide-react"
import { toast } from "sonner"

import type {
  PrintBridge,
  PrinterDevice,
  PrintJob,
} from "@/components/admin/types"
import { Button } from "@/components/ui/button"

export function PrinterSetupGuide({
  bridges,
  devices,
  jobs,
  apiUrl,
  connectDisabled = false,
  onConnect,
  onAddPrinter,
  onRefresh,
}: {
  bridges: PrintBridge[]
  devices: PrinterDevice[]
  jobs: PrintJob[]
  apiUrl: string
  connectDisabled?: boolean
  onConnect: () => void
  onAddPrinter: () => void
  onRefresh: () => void
}) {
  const installed = bridges.some(
    (bridge) =>
      bridge.is_active && (bridge.is_online || Boolean(bridge.last_seen_at)),
  )
  const connected = bridges.some(
    (bridge) => bridge.is_active && bridge.is_online,
  )
  const mapped = new Set(
    bridges
      .filter((bridge) => bridge.is_active)
      .flatMap((bridge) =>
        bridge.printer_mappings.map((mapping) => mapping.printer_device_id),
      ),
  )
  const activeDevices = devices.filter((device) => device.is_active)
  const mappedCount = activeDevices.filter((device) =>
    mapped.has(device.id),
  ).length
  const outputConfirmed = jobs.some((job) => job.status === "PRINTED")
  const steps = [
    {
      title: "Uygulamayı kur",
      done: installed,
      text: "Yazıcının kurulu olduğu bilgisayara Dixora Print Bridge uygulamasını indirin.",
    },
    {
      title: "Bilgisayarı bağla",
      done: connected,
      text: "Bağlantı kodunu ve API adresini uygulamaya girin. Bilgisayar çevrimiçi görünmelidir.",
    },
    {
      title: "Yazıcıları eşleştir",
      done: activeDevices.length > 0 && mappedCount === activeDevices.length,
      text: `${mappedCount}/${activeDevices.length} aktif cihaz eşlendi. Mutfak, bar ve kasa için doğru yazıcıyı seçin.`,
    },
    {
      title: "Çıktıyı kontrol et",
      done: outputConfirmed,
      text: "Eşlediğiniz cihazdan test çıktısı alın ve kağıdı kontrol edin. Son işleri aşağıdan izleyin.",
    },
  ]
  return (
    <section
      aria-label="Yazıcı kurulum adımları"
      className="rounded-xl border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Yazdırmayı dört adımda hazırlayın</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Bu adımlar seçili şubenin gerçek bağlantı ve çıktı durumuna göre
            güncellenir.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          Bağlantıyı kontrol et
        </Button>
      </div>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
              {step.done ? (
                <Check
                  className="size-3.5 text-emerald-700"
                  aria-hidden="true"
                />
              ) : (
                index + 1
              )}
            </span>
            <div>
              <h3 className="text-sm font-medium">{step.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {step.done ? "Tamamlandı" : "Bekleniyor"}
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {step.text}
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button size="sm" disabled={connectDisabled} onClick={onConnect}>
          <Laptop aria-hidden="true" />
          Bilgisayar bağla
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={connectDisabled}
          onClick={onAddPrinter}
        >
          <Printer aria-hidden="true" />
          Yazıcı ekle
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(apiUrl)
              toast.success("API adresi kopyalandı")
            } catch {
              toast.error("Adres kopyalanamadı. Aşağıdaki adresi kullanın.")
            }
          }}
        >
          <Copy aria-hidden="true" />
          API adresini kopyala
        </Button>
        <code
          className="min-w-0 max-w-full break-all text-xs text-muted-foreground"
          translate="no"
        >
          {apiUrl}
        </code>
      </div>
      {!activeDevices.some((device) => device.purpose === "CASHIER") ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          Hesap fişi için “Kasa / hesap fişi” rolünde bir yazıcı ekleyin.
          Hazırlık yazıcısı bu fişlerin yerine kullanılmaz.
        </p>
      ) : null}
    </section>
  )
}
