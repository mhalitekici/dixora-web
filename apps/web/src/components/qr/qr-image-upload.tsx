"use client"

import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"

import {
  useDeleteQrAsset,
  useUploadQrAsset,
} from "@/components/qr/qr-hooks"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export function QrImageUpload({
  assetKind,
  label,
  description,
  value,
  onChange,
}: {
  assetKind: "logo" | "cover"
  label: string
  description: string
  value: string | null
  onChange: (value: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useUploadQrAsset()
  const remove = useDeleteQrAsset()
  const busy = upload.isPending || remove.isPending

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (!IMAGE_TYPES.has(file.type)) {
      toast.error("Yalnızca JPEG, PNG veya WebP görselleri yükleyebilirsiniz.")
      return
    }
    if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      toast.error("Görsel boş olmamalı ve 5 MB'ı geçmemelidir.")
      return
    }
    try {
      const config = await upload.mutateAsync({ assetKind, file })
      const nextValue =
        assetKind === "logo" ? config.logo_url : config.cover_image_url
      onChange(nextValue)
      toast.success(`${label} yüklendi.`)
    } catch (error) {
      toast.error(`${label} yüklenemedi.`, {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      })
    }
  }

  async function removeImage() {
    try {
      await remove.mutateAsync(assetKind)
      onChange(null)
      toast.success(`${label} kaldırıldı.`)
    } catch (error) {
      toast.error(`${label} kaldırılamadı.`, {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      })
    }
  }

  return (
    <section className="space-y-3 rounded-xl border p-4" aria-label={label}>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-xl border border-dashed bg-muted/40",
          assetKind === "cover" ? "h-36" : "h-28",
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={`${label} önizlemesi`}
            className={cn(
              "size-full",
              assetKind === "cover" ? "object-cover" : "object-contain p-4",
            )}
          />
        ) : (
          <div className="text-center text-muted-foreground">
            <ImageIcon className="mx-auto size-6" />
            <p className="mt-2 text-xs">Henüz görsel yüklenmedi</p>
          </div>
        )}
        {busy ? (
          <div className="absolute inset-0 grid place-items-center bg-background/75">
            <Loader2 className="size-5 animate-spin text-brand" />
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload />
          {value ? "Değiştir" : "Görsel seç"}
        </Button>
        {value ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void removeImage()}
          >
            <Trash2 />
            Kaldır
          </Button>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`${label} dosyası seç`}
        onChange={(event) => {
          void handleFile(event.target.files?.[0])
          event.target.value = ""
        }}
      />
    </section>
  )
}
