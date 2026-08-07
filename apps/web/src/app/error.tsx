"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect } from "react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dixora route error", error);
  }, [error]);

  return (
    <main className="grid min-h-svh place-items-center bg-background px-5">
      <section className="max-w-lg text-center">
        <BrandLogo variant="mark" className="mx-auto mb-7 size-14" priority />
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-600">
          <TriangleAlert className="size-5" />
        </span>
        <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
          Ekran yüklenemedi
        </h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          İşlem verileriniz korunuyor. Bağlantıyı yenileyip bu ekranı tekrar açabilirsiniz.
        </p>
        <Button className="mt-7" onClick={reset}>
          <RefreshCw className="size-4" />
          Yeniden dene
        </Button>
        {error.digest ? (
          <p className="mt-4 font-mono text-[0.68rem] text-muted-foreground/60">
            Olay: {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}

