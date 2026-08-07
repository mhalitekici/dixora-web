"use client"

import {
  Clipboard,
  Download,
  Loader2,
  Printer,
  QrCode,
  RefreshCw,
  Search,
} from "lucide-react"
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { QrAdminNav } from "@/components/qr/qr-admin-nav"
import {
  useQrTables,
  useRegenerateTableToken,
} from "@/components/qr/qr-hooks"
import type { DiningTableDto } from "@/components/qr/types"
import { safeFileName } from "@/components/qr/qr-utils"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { useCurrentUser } from "@/hooks/use-auth"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL
const defaultBusinessSlug =
  process.env.NEXT_PUBLIC_QR_BUSINESS_SLUG ?? ""
const defaultBranchSlug =
  process.env.NEXT_PUBLIC_QR_BRANCH_SLUG ?? "merkez"

export function QrCodeList() {
  const currentUser = useCurrentUser()
  const tablesQuery = useQrTables()
  const regenerate = useRegenerateTableToken()
  const [search, setSearch] = useState("")
  const [businessSlug, setBusinessSlug] = useState(defaultBusinessSlug)
  const [branchSlug, setBranchSlug] = useState("")
  const appUrl = (configuredAppUrl ?? "http://localhost:3000").replace(
    /\/+$/,
    "",
  )
  const normalizedSearch = search.trim().toLocaleLowerCase("tr-TR")

  const effectiveBusinessSlug =
    businessSlug || currentUser.data?.tenant?.slug || ""
  const effectiveBranchSlug =
    branchSlug || currentUser.data?.branch?.slug || defaultBranchSlug
  const tables = useMemo(
    () =>
      (tablesQuery.data ?? []).filter((table) =>
        table.name.toLocaleLowerCase("tr-TR").includes(normalizedSearch),
      ),
    [normalizedSearch, tablesQuery.data],
  )
  const slugsReady = Boolean(
    effectiveBusinessSlug.trim() && effectiveBranchSlug.trim(),
  )
  const generalUrl = buildMenuUrl(
    appUrl,
    effectiveBusinessSlug,
    effectiveBranchSlug,
    null,
  )

  async function regenerateToken(table: DiningTableDto) {
    try {
      await regenerate.mutateAsync(table.id)
      toast.success(`${table.name} için QR token yenilendi`, {
        description: "Eski QR kodu artık geçersizdir.",
      })
    } catch (error) {
      toast.error("Token yenilenemedi", {
        description:
          error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      })
    }
  }

  return (
    <div>
      <QrAdminNav />
      <PageHeader
        eyebrow="Masa erişimi"
        title="QR Kodları"
        description="Şube ve masa menü bağlantılarını indirin, yazdırın veya güvenlik gerektiğinde tokenı yenileyin."
        icon={QrCode}
      />

      <section
        className="mb-5 grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]"
        data-print-hidden="true"
      >
        <div className="space-y-2">
          <Label htmlFor="qr-business-slug">İşletme slug</Label>
          <Input
            id="qr-business-slug"
            value={effectiveBusinessSlug}
            onChange={(event) => setBusinessSlug(event.target.value)}
            className="h-10 rounded-xl"
            autoCapitalize="none"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="qr-branch-slug">Şube slug</Label>
          <Input
            id="qr-branch-slug"
            value={effectiveBranchSlug}
            onChange={(event) => setBranchSlug(event.target.value)}
            className="h-10 rounded-xl"
            autoCapitalize="none"
          />
        </div>
        <div className="flex items-end">
          {!configuredAppUrl ? (
            <Badge variant="outline" className="h-10 rounded-xl px-3 text-amber-700">
              Geliştirme URL’si
            </Badge>
          ) : (
            <StatusBadge tone="success">Canlı URL</StatusBadge>
          )}
        </div>
        <p className="text-xs leading-5 text-muted-foreground sm:col-span-2 lg:col-span-3">
          Backend mevcut oturum yanıtında slug bilgisi döndürmediği için bu iki
          alan ortam değişkenlerinden alınır ve gerektiğinde burada
          düzenlenebilir. Üretilen QR tokenları gerçek masa API verisidir.
        </p>
      </section>

      {!slugsReady ? (
        <div className="mb-5 rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          QR kodu üretmek için işletme ve şube slug alanlarını doldurun.
        </div>
      ) : null}

      <div
        className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        data-print-hidden="true"
      >
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Masa ara"
            name="table-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Masa ara…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {tables.length} kod gösteriliyor
        </p>
      </div>

      {tablesQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <Skeleton key={item} className="h-[390px] rounded-xl" />
          ))}
        </div>
      ) : tablesQuery.isError ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center">
          <p className="font-semibold">Masa listesi alınamadı</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tablesQuery.error.message}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void tablesQuery.refetch()}
          >
            Tekrar dene
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <QrCodeCard
            name="Genel şube menüsü"
            detail="Masa seçmeden yalnız menüyü açar"
            url={generalUrl}
            active={slugsReady}
          />
          {tables.map((table) => (
            <QrCodeCard
              key={table.id}
              name={table.name}
              detail={`${table.capacity} kişilik · ${table.state}`}
              url={buildMenuUrl(
                appUrl,
                effectiveBusinessSlug,
                effectiveBranchSlug,
                table.qr_token,
              )}
              active={slugsReady && table.is_active}
              regenerating={
                regenerate.isPending && regenerate.variables === table.id
              }
              onRegenerate={() => void regenerateToken(table)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QrCodeCard({
  name,
  detail,
  url,
  active,
  regenerating = false,
  onRegenerate,
}: {
  name: string
  detail: string
  url: string
  active: boolean
  regenerating?: boolean
  onRegenerate?: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const fileName = safeFileName(name)

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Menü bağlantısı kopyalandı")
    } catch {
      toast.error("Bağlantı kopyalanamadı")
    }
  }

  function downloadPng() {
    const canvas = canvasRef.current
    if (!canvas) return
    downloadUrl(canvas.toDataURL("image/png"), `${fileName}.png`)
  }

  function downloadSvg() {
    const svg = svgRef.current
    if (!svg) return
    const source = new XMLSerializer().serializeToString(svg)
    const blob = new Blob([source], {
      type: "image/svg+xml;charset=utf-8",
    })
    const objectUrl = URL.createObjectURL(blob)
    downloadUrl(objectUrl, `${fileName}.svg`)
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  }

  function printCode() {
    const canvas = canvasRef.current
    if (!canvas) return
    const popup = window.open("", "_blank", "width=720,height=760")
    if (!popup) {
      toast.error("Yazdırma penceresi açılamadı")
      return
    }
    popup.opener = null
    popup.document.title = `${name} QR Kodu`
    const style = popup.document.createElement("style")
    style.textContent =
      "body{font-family:Arial,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center}main{max-width:520px}img{width:360px;height:360px}h1{margin:20px 0 8px}p{color:#555;word-break:break-all;line-height:1.5}"
    popup.document.head.append(style)
    const main = popup.document.createElement("main")
    const image = popup.document.createElement("img")
    image.src = canvas.toDataURL("image/png")
    image.alt = ""
    const heading = popup.document.createElement("h1")
    heading.textContent = name
    const text = popup.document.createElement("p")
    text.textContent = url
    main.append(image, heading, text)
    popup.document.body.append(main)
    image.addEventListener("load", () => {
      popup.focus()
      popup.print()
    })
  }

  return (
    <article className="break-inside-avoid rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{name}</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <StatusBadge tone={active ? "success" : "neutral"}>
          {active ? "Aktif" : "Pasif"}
        </StatusBadge>
      </div>

      <div className="mx-auto my-5 flex size-[230px] items-center justify-center rounded-2xl border bg-white p-2">
        <QRCodeCanvas
          ref={canvasRef}
          value={url}
          size={1024}
          level="H"
          marginSize={3}
          title={`${name} QR kodu`}
          style={{ height: 210, width: 210 }}
        />
        <QRCodeSVG
          ref={svgRef}
          value={url}
          size={1024}
          level="H"
          marginSize={3}
          title={`${name} QR kodu`}
          className="hidden"
        />
      </div>

      <p className="line-clamp-2 min-h-10 break-all rounded-lg bg-muted/60 p-2 font-mono text-[0.65rem] leading-4 text-muted-foreground">
        {url}
      </p>

      <div
        className="mt-4 grid grid-cols-4 gap-1.5"
        data-print-hidden="true"
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => void copyUrl()}
          aria-label="Bağlantıyı kopyala"
          disabled={!active}
        >
          <Clipboard />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={downloadPng}
          aria-label="PNG indir"
          disabled={!active}
        >
          <Download />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={downloadSvg}
          aria-label="SVG indir"
          disabled={!active}
        >
          <span className="text-[0.65rem] font-bold">SVG</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={printCode}
          aria-label="QR kodunu yazdır"
          disabled={!active}
        >
          <Printer />
        </Button>
      </div>

      {onRegenerate ? (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="destructive"
                className="mt-2 h-9 w-full"
                disabled={regenerating}
                data-print-hidden="true"
              />
            }
          >
            {regenerating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            Güvenlik tokenını yenile
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive">
                <RefreshCw />
              </AlertDialogMedia>
              <AlertDialogTitle>QR tokenı yenilensin mi?</AlertDialogTitle>
              <AlertDialogDescription>
                {name} için basılmış tüm eski QR kodları hemen geçersiz olur.
                Yeni kodu tekrar indirip basmanız gerekir.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Vazgeç</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={onRegenerate}
              >
                Tokenı yenile
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </article>
  )
}

function buildMenuUrl(
  appUrl: string,
  businessSlug: string,
  branchSlug: string,
  tableToken: string | null,
): string {
  const base = `${appUrl}/m/${encodeURIComponent(
    businessSlug.trim(),
  )}/${encodeURIComponent(branchSlug.trim())}`
  return tableToken
    ? `${base}/table/${encodeURIComponent(tableToken)}`
    : base
}

function downloadUrl(url: string, fileName: string) {
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
}
