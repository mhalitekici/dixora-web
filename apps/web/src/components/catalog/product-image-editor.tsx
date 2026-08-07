"use client"

import { Loader2, Maximize2, Move } from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"

import {
  calculateCropPlacement,
  clampCropPosition,
  createCroppedProductImage,
  type CropPosition,
} from "@/components/catalog/product-image-crop"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

export type ProductImageEditorSource = {
  file: File
  url: string
}

export function ProductImageEditor({
  open,
  source,
  onCancel,
  onComplete,
}: {
  open: boolean
  source: ProductImageEditorSource | null
  onCancel: () => void
  onComplete: (file: File) => void
}) {
  const cropRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerX: number
    pointerY: number
    position: CropPosition
  } | null>(null)
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 })
  const [viewportSize, setViewportSize] = useState(1)
  const [position, setPosition] = useState<CropPosition>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [outputSize, setOutputSize] = useState(1200)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const element = cropRef.current
    if (!element || !open) return
    const update = () => setViewportSize(Math.max(1, element.clientWidth))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open])

  const placement = useMemo(
    () =>
      calculateCropPlacement({
        sourceHeight: imageSize.height,
        sourceWidth: imageSize.width,
        targetHeight: viewportSize,
        targetWidth: viewportSize,
        zoom,
        position,
      }),
    [imageSize, position, viewportSize, zoom],
  )

  function updatePosition(next: CropPosition) {
    setPosition({
      x: clampCropPosition(next.x),
      y: clampCropPosition(next.y),
    })
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (busy) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      position,
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    updatePosition({
      x:
        drag.position.x +
        (event.clientX - drag.pointerX) / Math.max(1, placement.maxOffsetX),
      y:
        drag.position.y +
        (event.clientY - drag.pointerY) / Math.max(1, placement.maxOffsetY),
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const amount = event.shiftKey ? 0.15 : 0.04
    const movement: Record<string, CropPosition> = {
      ArrowLeft: { x: -amount, y: 0 },
      ArrowRight: { x: amount, y: 0 },
      ArrowUp: { x: 0, y: -amount },
      ArrowDown: { x: 0, y: amount },
    }
    const delta = movement[event.key]
    if (!delta) return
    event.preventDefault()
    updatePosition({ x: position.x + delta.x, y: position.y + delta.y })
  }

  async function applyCrop() {
    if (!source) return
    setBusy(true)
    setError(null)
    try {
      const file = await createCroppedProductImage({
        file: source.file,
        outputSize,
        position,
        zoom,
      })
      onComplete(file)
    } catch (cropError) {
      setError(
        cropError instanceof Error
          ? cropError.message
          : "Görsel kırpılamadı. Başka bir dosya deneyin.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel()
      }}
    >
      <DialogContent className="max-h-[94dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Ürün görselini düzenle</DialogTitle>
          <DialogDescription>
            Görseli sürükleyerek konumlandırın; yakınlaştırma ve çıktı boyutunu
            ayarladıktan sonra kırpmayı uygulayın.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div
            ref={cropRef}
            role="group"
            aria-label="Kare kırpma alanı. Görseli sürükleyin veya ok tuşlarıyla konumlandırın."
            tabIndex={0}
            className="relative aspect-square touch-none overflow-hidden rounded-xl bg-neutral-950 shadow-inner outline-none focus-visible:ring-3 focus-visible:ring-brand/45"
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => {
              dragRef.current = null
            }}
            onPointerCancel={() => {
              dragRef.current = null
            }}
          >
            {source ? (
              // Local object URLs are intentionally rendered without the Next image optimizer.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={source.url}
                alt="Kırpılacak ürün görseli"
                width={imageSize.width}
                height={imageSize.height}
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  height: placement.drawHeight,
                  left: placement.left,
                  top: placement.top,
                  width: placement.drawWidth,
                }}
                onLoad={(event) =>
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
              />
            ) : null}
            <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-45">
              {Array.from({ length: 9 }).map((_, index) => (
                <span key={index} className="border border-white/35" />
              ))}
            </div>
            <div className="pointer-events-none absolute inset-3 rounded-lg border border-white/80 shadow-[0_0_0_999px_rgb(0_0_0/0.28)]" />
            <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/65 px-3 py-1.5 text-[0.65rem] font-medium text-white">
              <Move className="size-3" aria-hidden="true" />
              Sürükleyerek konumlandırın
            </div>
          </div>

          <div className="space-y-5 rounded-xl border bg-muted/25 p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="product-image-zoom">Yakınlaştırma</Label>
                <span className="tabular-nums text-xs text-muted-foreground">
                  {zoom.toFixed(1)}×
                </span>
              </div>
              <input
                id="product-image-zoom"
                name="product-image-zoom"
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                disabled={busy}
                className="h-8 w-full cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-50"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-image-size">Çıktı boyutu</Label>
              <select
                id="product-image-size"
                name="product-image-size"
                value={outputSize}
                disabled={busy}
                className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                onChange={(event) => setOutputSize(Number(event.target.value))}
              >
                <option value={800}>800 × 800 px</option>
                <option value={1200}>1200 × 1200 px · Önerilen</option>
                <option value={1600}>1600 × 1600 px</option>
              </select>
            </div>

            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={busy || (zoom === 1 && position.x === 0 && position.y === 0)}
              onClick={() => {
                setZoom(1)
                setPosition({ x: 0, y: 0 })
              }}
            >
              <Maximize2 />
              Görünümü sıfırla
            </Button>
            <p className="text-xs leading-5 text-muted-foreground">
              Kare çıktı ürün listesi, garson ekranı ve QR menüde tutarlı görünür.
            </p>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Vazgeç
          </Button>
          <Button type="button" disabled={busy || !source} onClick={() => void applyCrop()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? "Görsel hazırlanıyor…" : "Kırpmayı uygula"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
