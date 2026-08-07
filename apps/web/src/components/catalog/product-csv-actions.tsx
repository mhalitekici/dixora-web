"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { api, apiDownload } from "@/lib/api"

const MAX_CSV_BYTES = 2 * 1024 * 1024
const MAX_XLSX_BYTES = 5 * 1024 * 1024

type CsvRow = {
  row_number: number
  category: string
  name: string
  selling_price: string
  sku: string | null
}

type CsvError = {
  row_number: number
  field: string | null
  message: string
}

type CsvResult = {
  status: "READY" | "SUCCESS" | "PARTIAL" | "FAILED"
  dry_run: boolean
  total_rows: number
  valid_rows: number
  imported_rows: number
  failed_rows: number
  rows: CsvRow[]
  errors: CsvError[]
}

export function ProductCsvActions({ disabled = false }: { disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<CsvResult | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const template = useMutation({
    mutationFn: () => apiDownload("catalog/products/import-template"),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = "dixora-urun-sablonu.xlsx"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      toast.success("Düzenlenebilir Excel ürün tablosu indirildi.")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Şablon indirilemedi."),
  })

  const preview = useMutation({
    mutationFn: (selectedFile: File) => upload(selectedFile, true),
    onSuccess: (nextResult) => {
      setResult(nextResult)
      setDialogOpen(true)
    },
    onError: (error) => {
      setDialogOpen(false)
      toast.error(error instanceof Error ? error.message : "Ürün dosyası doğrulanamadı.")
    },
  })

  const importCsv = useMutation({
    mutationFn: (selectedFile: File) => upload(selectedFile, false),
    onSuccess: async (nextResult) => {
      setResult(nextResult)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["catalog", "products"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog", "categories"] }),
      ])
      if (nextResult.imported_rows > 0) {
        toast.success(`${nextResult.imported_rows} ürün içe aktarıldı.`)
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Ürünler içe aktarılamadı."),
  })

  function selectFile() {
    inputRef.current?.click()
  }

  function handleFile(selectedFile: File | undefined) {
    if (!selectedFile) return
    const lowerName = selectedFile.name.toLocaleLowerCase("tr-TR")
    if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".csv")) {
      toast.error("Yalnızca .xlsx veya .csv ürün dosyaları yüklenebilir.")
      return
    }
    const maximumBytes = lowerName.endsWith(".xlsx") ? MAX_XLSX_BYTES : MAX_CSV_BYTES
    if (selectedFile.size === 0 || selectedFile.size > maximumBytes) {
      const maximumMegabytes = maximumBytes / 1024 / 1024
      toast.error(`Ürün dosyası boş olmamalı ve ${maximumMegabytes} MB'ı geçmemelidir.`)
      return
    }
    setFile(selectedFile)
    setResult(null)
    setDialogOpen(true)
    preview.mutate(selectedFile)
  }

  function closeDialog() {
    if (preview.isPending || importCsv.isPending) return
    setDialogOpen(false)
    setFile(null)
    setResult(null)
  }

  const completed = result?.dry_run === false
  const canImport = Boolean(file && result?.valid_rows && !completed)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              disabled={disabled || template.isPending || preview.isPending}
            />
          }
        >
          <FileSpreadsheet />
          İçe / dışa aktar
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => template.mutate()}>
            <Download />
            Excel ürün tablosunu indir (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={selectFile}>
            <Upload />
            Doldurulan Excel / CSV dosyasını yükle
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="sr-only"
        aria-label="Excel veya CSV ürün dosyası seç"
        onChange={(event) => {
          handleFile(event.target.files?.[0])
          event.target.value = ""
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {completed ? "İçe aktarma sonucu" : "Ürün tablosu önizleme ve doğrulama"}
            </DialogTitle>
            <DialogDescription>
              {file?.name ?? "Seçilen dosya"} güvenli biçimde doğrulanıyor. Hatalı
              satırlar oluşturulmaz.
            </DialogDescription>
          </DialogHeader>

          {preview.isPending ? (
            <div className="flex min-h-48 items-center justify-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-5 animate-spin text-brand" />
              Dosya doğrulanıyor…
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Summary label="Toplam satır" value={result.total_rows} />
                <Summary label={completed ? "Aktarılan" : "Hazır"} value={completed ? result.imported_rows : result.valid_rows} tone="success" />
                <Summary label="Hatalı" value={result.failed_rows} tone={result.failed_rows ? "danger" : "neutral"} />
              </div>

              {completed ? (
                <div className="flex items-start gap-3 rounded-xl border border-emerald-600/20 bg-emerald-500/5 p-4">
                  <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-700" />
                  <div>
                    <p className="text-sm font-semibold">Aktarım tamamlandı</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {result.imported_rows} ürün oluşturuldu. {result.failed_rows > 0 ? `${result.failed_rows} hatalı satır atlandı.` : "Tüm satırlar başarıyla işlendi."}
                    </p>
                  </div>
                </div>
              ) : null}

              {result.errors.length > 0 ? (
                <section aria-labelledby="csv-errors-title" className="rounded-xl border border-destructive/20 bg-destructive/5 p-4">
                  <h3 id="csv-errors-title" className="flex items-center gap-2 text-sm font-semibold text-destructive">
                    <AlertTriangle className="size-4" />
                    Düzeltilmesi gereken satırlar
                  </h3>
                  <ul className="mt-3 max-h-44 space-y-2 overflow-y-auto text-xs leading-5">
                    {result.errors.map((error, index) => (
                      <li key={`${error.row_number}-${error.field}-${index}`}>
                        <span className="font-semibold">Satır {error.row_number}:</span>{" "}
                        {error.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {!completed && result.rows.length > 0 ? (
                <section aria-labelledby="csv-preview-title">
                  <h3 id="csv-preview-title" className="text-sm font-semibold">Aktarılmaya hazır ürünler</h3>
                  <div className="mt-2 overflow-hidden rounded-xl border">
                    <div className="grid grid-cols-[4rem_1fr_1fr_6rem] gap-2 bg-muted/60 px-3 py-2 text-[0.68rem] font-semibold text-muted-foreground">
                      <span>Satır</span><span>Ürün</span><span>Kategori</span><span className="text-right">Fiyat</span>
                    </div>
                    {result.rows.slice(0, 8).map((row) => (
                      <div key={row.row_number} className="grid grid-cols-[4rem_1fr_1fr_6rem] gap-2 border-t px-3 py-2 text-xs">
                        <span>{row.row_number}</span><span className="truncate font-medium">{row.name}</span><span className="truncate text-muted-foreground">{row.category}</span><span className="text-right">{row.selling_price} ₺</span>
                      </div>
                    ))}
                  </div>
                  {result.rows.length > 8 ? <p className="mt-2 text-xs text-muted-foreground">İlk 8 satır gösteriliyor; toplam {result.rows.length} geçerli ürün var.</p> : null}
                </section>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={preview.isPending || importCsv.isPending}>
              {completed ? "Kapat" : "Vazgeç"}
            </Button>
            {!completed ? (
              <Button disabled={!canImport || importCsv.isPending} onClick={() => file && importCsv.mutate(file)}>
                {importCsv.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                {importCsv.isPending ? "İçe aktarılıyor…" : `${result?.valid_rows ?? 0} ürünü içe aktar`}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Summary({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "success" | "danger" }) {
  const color = tone === "success" ? "text-emerald-700" : tone === "danger" ? "text-destructive" : "text-foreground"
  return <div className="rounded-xl border bg-card p-3"><p className={`text-xl font-semibold ${color}`}>{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{label}</p></div>
}

async function upload(file: File, dryRun: boolean): Promise<CsvResult> {
  const formData = new FormData()
  formData.append("file", file)
  return api.post<CsvResult>("catalog/products/csv-import", formData, {
    search: { dry_run: dryRun },
    timeoutMs: 60_000,
  })
}
