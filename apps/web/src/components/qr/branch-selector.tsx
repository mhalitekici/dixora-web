"use client";

import { ArrowRight, MapPin, RefreshCw, Store, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type PublicBranch = {
  name: string;
  slug: string;
  address?: string | null;
  is_open?: boolean;
};

export function BranchSelector({ businessSlug }: { businessSlug: string }) {
  const [branches, setBranches] = useState<PublicBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(
          `/api/backend/qr/public/${encodeURIComponent(businessSlug)}/branches`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("not available");
        const payload = (await response.json()) as PublicBranch[];
        setBranches(payload);
        setLoadFailed(false);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setBranches([]);
          setLoadFailed(true);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [businessSlug, reload]);

  return (
    <main className="relative min-h-svh overflow-hidden bg-[#171717] px-4 py-8 text-white sm:px-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(236,90,32,.22),transparent_35%),radial-gradient(circle_at_80%_90%,rgba(255,255,255,.08),transparent_35%)]" />
      <div className="relative mx-auto flex min-h-[calc(100svh-4rem)] max-w-3xl flex-col">
        <header className="flex items-center justify-between">
          <BrandLogo variant="mark" className="h-10 w-auto" priority />
          <Badge className="border-white/10 bg-white/10 text-white">Dixora QR Menü</Badge>
        </header>

        <section className="my-auto py-14">
          <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-brand text-[#21100a] shadow-[0_20px_60px_rgba(236,90,32,.3)]">
            <UtensilsCrossed className="size-6" />
          </span>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-brand">
            Hoş geldiniz
          </p>
          <h1 className="max-w-xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            Menüyü görmek istediğiniz şubeyi seçin.
          </h1>
          <p className="mt-4 max-w-xl leading-7 text-white/55">
            Güncel ürünleri ve fiyatları görüntüleyin; masanızdaki QR kodu okuttuysanız
            servis ya da sipariş talebi de oluşturabilirsiniz.
          </p>

          <div className="mt-9 grid gap-3">
            {loadFailed ? (
              <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100 sm:flex-row sm:items-center">
                <p className="flex-1">
                  Şube bilgilerine şu anda ulaşılamıyor. Bağlantıyı kontrol edip yeniden deneyin.
                </p>
                <Button
                  variant="outline"
                  className="border-white/15 bg-transparent text-white hover:bg-white/10"
                  onClick={() => {
                    setLoading(true);
                    setReload((value) => value + 1);
                  }}
                >
                  <RefreshCw />
                  Yeniden dene
                </Button>
              </div>
            ) : null}
            {branches.map((branch) => (
              <Card
                key={branch.slug}
                className="border-white/10 bg-white/[0.06] text-white ring-white/10 backdrop-blur"
              >
                <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                    <Store className="size-5 text-brand" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{branch.name}</h2>
                      {branch.is_open !== false ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300">Açık</Badge>
                      ) : (
                        <Badge className="bg-white/10 text-white/60">Kapalı</Badge>
                      )}
                    </div>
                    {branch.address ? (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-white/50">
                        <MapPin className="size-3.5" />
                        {branch.address}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    render={
                      <Link href={`/m/${businessSlug}/${branch.slug}`}>
                        Menüyü aç
                        <ArrowRight className="size-4" />
                      </Link>
                    }
                    className="w-full sm:w-auto"
                    disabled={branch.is_open === false}
                  />
                </CardContent>
              </Card>
            ))}
            {!loading && branches.length === 0 ? (
              <Card className="border-white/10 bg-white/[0.06] text-white ring-white/10">
                <CardContent className="py-10 text-center">
                  <Store className="mx-auto mb-3 size-7 text-white/35" />
                  <p className="font-medium">Açık bir şube bulunamadı</p>
                  <p className="mt-1 text-sm text-white/45">
                    İşletme bağlantısını kontrol edip yeniden deneyin.
                  </p>
                </CardContent>
              </Card>
            ) : null}
            {loading && branches.length === 0 ? (
              <div className="h-24 animate-pulse rounded-2xl bg-white/[0.06]" />
            ) : null}
          </div>
        </section>

        <footer className="flex items-center justify-between border-t border-white/10 pt-5 text-xs text-white/35">
          <span>Dixora ile güvenli dijital menü</span>
          <span>Fiyatlar şubeye özeldir.</span>
        </footer>
      </div>
    </main>
  );
}
