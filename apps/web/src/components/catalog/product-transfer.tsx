"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Download, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiDownload } from "@/lib/api"
import { cn } from "@/lib/utils"

type ImportError = { row_number: number; field: string | null; message: string }

type ImportResult = {
  status: "READY" | "SUCCESS" | "PARTIAL" | "FAILED"
  dry_run: boolean
  total_rows: number
  valid_rows: number
  imported_rows: number
  failed_rows: number
  errors: ImportError[]
}

async function upload(
  file: File,
  dryRun: boolean,
  updateExisting: boolean,
): Promise<ImportResult> {
  const body = new FormData()
  body.append("file", file)
  const response = await fetch(
    `/api/backend/catalog/products/csv-import?dry_run=${dryRun}` +
      `&update_existing=${updateExisting}`,
    { method: "POST", body, credentials: "include" },
  )
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "Dosya yüklenemedi.")
  }
  return payload as ImportResult
}

/**
 * Moving a menu between businesses.
 *
 * Products belong to the business rather than to a branch, so a new branch
 * already has the whole catalogue — this is for carrying a menu to a different
 * business, or editing prices in a spreadsheet and loading them back.
 */
export function ProductTransfer() {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  // Off by default: the safe reading of "upload products" is adding them, not
  // silently rewriting a menu that is being sold from right now.
  const [updateExisting, setUpdateExisting] = useState(false)

  const exportMutation = useMutation({
    mutationFn: () => apiDownload("catalog/products/export"),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `dixora-urunler-${new Date().toISOString().slice(0, 10)}.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "İndirilemedi."),
  })

  // Always previewed first: an import that silently rewrites a live menu is
  // not something anyone should trigger with one click.
  const previewMutation = useMutation({
    mutationFn: ({ file, update }: { file: File; update: boolean }) =>
      upload(file, true, update),
    onSuccess: (result) => setPreview(result),
    onError: (error) => {
      setPending(null)
      toast.error(error instanceof Error ? error.message : "Dosya okunamadı.")
    },
  })

  const applyMutation = useMutation({
    mutationFn: (file: File) => upload(file, false, updateExisting),
    onSuccess: async (result) => {
      setPreview(null)
      setPending(null)
      toast.success(`${result.imported_rows} ürün yüklendi`, {
        description:
          result.failed_rows > 0
            ? `${result.failed_rows} satır atlandı.`
            : undefined,
      })
      await queryClient.invalidateQueries({ queryKey: ["catalog"] })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Yükleme başarısız."),
  })

  function choose(file: File | undefined) {
    if (!file) return
    setPending(file)
    previewMutation.mutate({ file, update: updateExisting })
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={exportMutation.isPending}
          onClick={() => exportMutation.mutate()}
        >
          {exportMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download />
          )}
          Ürünleri indir
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={previewMutation.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {previewMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Upload />
          )}
          Ürün yükle
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv"
          aria-label="Ürün dosyası seç"
          className="hidden"
          onChange={(event) => {
            choose(event.target.files?.[0])
            // Reset so choosing the same file twice still fires.
            event.target.value = ""
          }}
        />
      </div>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null)
            setPending(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yüklemeden önce kontrol</DialogTitle>
            <DialogDescription>
              Dosya henüz uygulanmadı. Aşağıdakiler doğruysa onaylayın.
            </DialogDescription>
          </DialogHeader>

          {preview ? (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ["Satır", preview.total_rows, ""],
                    ["Geçerli", preview.valid_rows, "text-emerald-600"],
                    ["Hatalı", preview.failed_rows, "text-rose-600"],
                  ] as const
                ).map(([label, value, tone]) => (
                  <div key={label} className="rounded-xl border p-2.5">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {label}
                    </p>
                    <p className={cn("text-lg font-bold tabular-nums", tone)}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {preview.errors.length > 0 ? (
                <div className="max-h-48 overflow-y-auto rounded-xl border">
                  <ul className="divide-y text-xs">
                    {preview.errors.slice(0, 30).map((issue, index) => (
                      <li key={index} className="px-2.5 py-1.5">
                        <span className="font-semibold">
                          {issue.row_number}. satır
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {issue.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                  <FileSpreadsheet className="size-4 shrink-0" aria-hidden="true" />
                  Tüm satırlar okunabildi.
                </p>
              )}

              <label
                className="flex items-start gap-2.5 rounded-xl border p-2.5"
                htmlFor="import-update-existing"
              >
                <Checkbox
                  id="import-update-existing"
                  checked={updateExisting}
                  onCheckedChange={(checked) => {
                    const next = checked === true
                    setUpdateExisting(next)
                    // Re-check the file: the same sheet reads very differently
                    // depending on this switch.
                    if (pending) previewMutation.mutate({ file: pending, update: next })
                  }}
                />
                <span className="text-xs leading-5">
                  <span className="font-semibold">Mevcut ürünleri güncelle</span>
                  <span className="block text-muted-foreground">
                    Açıkken aynı stok kodu ya da aynı isimdeki ürünler
                    güncellenir. Kapalıyken bunlar atlanır ve yalnızca yeni
                    ürünler eklenir.
                  </span>
                </span>
              </label>

              <p className="text-[0.7rem] leading-5 text-muted-foreground">
                Dosyada bulunmayan ürünler hiçbir durumda silinmez.
              </p>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Vazgeç
            </Button>
            <Button
              disabled={
                !pending ||
                applyMutation.isPending ||
                (preview?.valid_rows ?? 0) === 0
              }
              onClick={() => pending && applyMutation.mutate(pending)}
            >
              {applyMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {preview?.valid_rows ?? 0} ürünü yükle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
