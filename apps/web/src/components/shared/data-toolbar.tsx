"use client";

import { Filter, Search, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function DataToolbar({
  value,
  onValueChange,
  placeholder = "Ara…",
  filters,
  actions,
  className,
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border bg-card p-3 shadow-[0_1px_2px_rgb(0_0_0/0.02)] sm:flex-row sm:items-center",
        className,
      )}
    >
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={placeholder}
          name="search"
          value={value}
          onChange={(event) => onValueChange?.(event.target.value)}
          placeholder={placeholder}
          className="h-10 rounded-xl pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {filters}
        {!filters ? (
          <Button
            variant="outline"
            className="h-10 rounded-xl"
            disabled
            title="Bu görünüm için ek filtre bulunmuyor"
          >
            <Filter />
            Filtrele
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-xl"
          aria-label="Görünüm ayarları yakında"
          title="Görünüm ayarları yakında"
          disabled
        >
          <SlidersHorizontal />
        </Button>
        {actions}
      </div>
    </div>
  );
}
