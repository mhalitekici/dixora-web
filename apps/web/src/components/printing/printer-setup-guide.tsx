import { Check, Copy, Laptop, Printer, X } from "lucide-react";
import { toast } from "sonner";

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
  physicalConfirmed = false,
  apiUrl,
  connectDisabled = false,
  onConnect,
  onAddPrinter,
  onRefresh,
}: {
  bridges: PrintBridge[];
  devices: PrinterDevice[];
  physicalConfirmed?: boolean;
  jobs: PrintJob[];
  apiUrl: string;
  connectDisabled?: boolean;
  onConnect: () => void;
  onAddPrinter: () => void;
  onRefresh: () => void;
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
  ).length;
  const outputConfirmed = physicalConfirmed;
  const softwarePrinted = jobs.some((job) => job.status === "PRINTED");
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
      text: softwarePrinted
        ? "Yazılım baskı sonucunu aldı. Kağıdı kontrol edip aşağıdaki test çıktısını doğrulayın."
        : "Test çıktısı alın, kağıdı ve Türkçe karakterleri kontrol edin.",
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
      <div className="mt-4 space-y-2">
        <progress
          className="h-2 w-full accent-primary"
          max={4}
          value={steps.filter((step) => step.done).length}
          aria-label="Kurulum ilerlemesi"
        />
        <p className="text-sm font-medium">
          {steps.filter((step) => step.done).length}/4 tamamlandı · Sıradaki
          işlem:{" "}
          {steps.find((step) => !step.done)?.title ?? "Kurulum tamamlandı"}
        </p>
      </div>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step) => (
          <li key={step.title} className="flex gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
              {step.done ? (
                <Check
                  className="size-3.5 text-emerald-700"
                  aria-hidden="true"
                />
              ) : (
                <X className="size-4 text-destructive" aria-hidden="true" />
              )}
            </span>
            <div>
              <h3 className="text-sm font-medium">{step.title}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {step.done ? "Tamamlandı" : "Tamamlanmadı"}
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
