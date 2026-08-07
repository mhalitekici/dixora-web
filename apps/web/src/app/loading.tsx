import { BrandLogo } from "@/components/brand/brand-logo";

export default function Loading() {
  return (
    <main className="grid min-h-svh place-items-center bg-background">
      <div className="text-center">
        <span className="relative mx-auto flex size-16 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-3xl bg-brand/15" />
          <BrandLogo variant="mark" className="relative size-12" priority />
        </span>
        <p className="mt-4 text-xs font-medium text-muted-foreground">Dixora hazırlanıyor…</p>
      </div>
    </main>
  );
}

