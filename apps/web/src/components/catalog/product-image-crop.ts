export type CropPosition = { x: number; y: number }

export type CropPlacement = {
  drawHeight: number
  drawWidth: number
  left: number
  maxOffsetX: number
  maxOffsetY: number
  top: number
}

export function clampCropPosition(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

export function calculateCropPlacement({
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
  zoom,
  position,
}: {
  sourceHeight: number
  sourceWidth: number
  targetHeight: number
  targetWidth: number
  zoom: number
  position: CropPosition
}): CropPlacement {
  const safeZoom = Math.max(1, zoom)
  const scale = Math.max(
    targetWidth / Math.max(1, sourceWidth),
    targetHeight / Math.max(1, sourceHeight),
  ) * safeZoom
  const drawWidth = sourceWidth * scale
  const drawHeight = sourceHeight * scale
  const maxOffsetX = Math.max(0, (drawWidth - targetWidth) / 2)
  const maxOffsetY = Math.max(0, (drawHeight - targetHeight) / 2)

  return {
    drawHeight,
    drawWidth,
    left:
      (targetWidth - drawWidth) / 2 +
      clampCropPosition(position.x) * maxOffsetX,
    maxOffsetX,
    maxOffsetY,
    top:
      (targetHeight - drawHeight) / 2 +
      clampCropPosition(position.y) * maxOffsetY,
  }
}

export async function createCroppedProductImage({
  file,
  outputSize,
  position,
  zoom,
}: {
  file: File
  outputSize: number
  position: CropPosition
  zoom: number
}): Promise<File> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  })

  try {
    const canvas = document.createElement("canvas")
    canvas.width = outputSize
    canvas.height = outputSize
    const context = canvas.getContext("2d")
    if (!context) throw new Error("Görsel düzenleyici başlatılamadı.")

    const placement = calculateCropPlacement({
      sourceHeight: bitmap.height,
      sourceWidth: bitmap.width,
      targetHeight: outputSize,
      targetWidth: outputSize,
      zoom,
      position,
    })
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = "high"
    context.drawImage(
      bitmap,
      placement.left,
      placement.top,
      placement.drawWidth,
      placement.drawHeight,
    )

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Kırpılmış görsel oluşturulamadı.")),
        "image/webp",
        0.9,
      )
    })
    const baseName = file.name.replace(/\.[^.]+$/, "") || "urun"
    return new File([blob], `${baseName}-kirpilmis.webp`, {
      type: "image/webp",
      lastModified: Date.now(),
    })
  } finally {
    bitmap.close()
  }
}
