import { ArrowLeft, Compass } from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="relative grid min-h-svh place-items-center overflow-hidden bg-background px-5">
      <div className="absolute inset-0 surface-grid opacity-[0.035]" />
      <div className="absolute left-1/2 top-1/2 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/8 blur-[100px]" />
      <section className="relative max-w-lg text-center">
        <BrandLogo variant="mark" className="mx-auto mb-8 size-16" priority />
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">404 · Rota yok</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
          Bu ekran serviste değil.
        </h1>
        <p className="mx-auto mt-4 max-w-md leading-7 text-muted-foreground">
          Bağlantı değişmiş veya erişmek istediğiniz kayıt kaldırılmış olabilir.
        </p>
        <Button className="mt-8" render={<Link href="/" />}>
          <ArrowLeft className="size-4" />
          Ana sayfaya dön
        </Button>
        <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Compass className="size-3.5" />
          Adresi kontrol edip yeniden deneyebilirsiniz.
        </p>
      </section>
    </main>
  );
}

