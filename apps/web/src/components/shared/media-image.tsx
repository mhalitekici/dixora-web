"use client";

import Image, { type ImageProps } from "next/image";
import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function mediaImageSource(src: string): string {
  try {
    const url = new URL(src, "https://dixora.invalid");
    if (/^\/api\/v1\/media\/(products|qr-menu)\//.test(url.pathname))
      return url.pathname;
  } catch {
    /* Local previews use the original browser URL. */
  }
  return src;
}

export function MediaImage({ src, alt, className, ...props }: ImageProps) {
  const source = typeof src === "string" ? mediaImageSource(src) : src;
  const [failedSource, setFailedSource] = useState<ImageProps["src"] | null>(
    null,
  );
  if (!source || failedSource === source)
    return (
      <span
        role={alt ? "img" : undefined}
        aria-label={alt ? `${alt} — görsel yüklenemedi` : undefined}
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          props.fill ? "absolute inset-0" : "size-full",
          className,
        )}
      >
        <ImageIcon className="size-6" aria-hidden="true" />
      </span>
    );
  return (
    <Image
      {...props}
      src={source}
      alt={alt}
      className={className}
      unoptimized={
        typeof source === "string" &&
        (source.startsWith("/api/") || source.startsWith("blob:"))
      }
      onError={(event) => {
        setFailedSource(source);
        props.onError?.(event);
      }}
    />
  );
}
