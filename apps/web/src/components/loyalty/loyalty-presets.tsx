"use client";

import { Coffee, Repeat, ShoppingBag, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type LoyaltyPreset = {
  id: string;
  label: string;
  summary: string;
  icon: LucideIcon;
  values: {
    campaign_type: "VISIT_COUNT" | "PRODUCT_QUANTITY";
    threshold: number;
    minimum_order_amount: string;
    allow_multiple_same_day: boolean;
  };
};

/**
 * Ready-made campaigns for the shapes owners actually ask for.
 *
 * Configuring a rule from scratch means picking a counting mode, a threshold, a
 * qualifying item, a reward, a minimum spend and two repeat toggles — six
 * decisions before anything goes live. A preset answers all but the product
 * choices, which is what makes this page usable for a café owner.
 */
export const LOYALTY_PRESETS: LoyaltyPreset[] = [
  {
    id: "coffee-5",
    label: "5 kahve alana 1 bedava",
    summary: "Seçtiğiniz üründen 5 adet alan müşteri 1 tane hediye kazanır.",
    icon: Coffee,
    values: {
      campaign_type: "PRODUCT_QUANTITY",
      threshold: 5,
      minimum_order_amount: "0.00",
      allow_multiple_same_day: true,
    },
  },
  {
    id: "visit-10",
    label: "10 ziyarette 1 ödül",
    summary: "Her uygun ziyaret 1 puan; 10. ziyarette ödül açılır.",
    icon: Repeat,
    values: {
      campaign_type: "VISIT_COUNT",
      threshold: 10,
      minimum_order_amount: "0.00",
      allow_multiple_same_day: false,
    },
  },
  {
    id: "visit-5-min",
    label: "5 ziyarette ödül (min. tutarlı)",
    summary: "Sadece 150 ₺ ve üzeri siparişler sayılır; 5 ziyarette ödül verilir.",
    icon: ShoppingBag,
    values: {
      campaign_type: "VISIT_COUNT",
      threshold: 5,
      minimum_order_amount: "150.00",
      allow_multiple_same_day: false,
    },
  },
];

export function LoyaltyPresetPicker({
  onSelect,
  activePresetId,
}: {
  onSelect: (preset: LoyaltyPreset) => void;
  activePresetId?: string | null;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-brand" aria-hidden="true" />
        <p className="text-sm font-semibold">Hazır kampanya seçin</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Bir şablon seçin, sonra ürünü ve ödülü belirleyin. Dilerseniz her ayrıntıyı
        aşağıdan değiştirebilirsiniz.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {LOYALTY_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const active = activePresetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onSelect(preset)}
              className={cn(
                "rounded-2xl border-2 p-3 text-left transition-colors",
                active ? "border-brand bg-brand-soft/40" : "hover:bg-muted/50",
              )}
            >
              <Icon
                className={cn("size-5", active ? "text-brand" : "text-muted-foreground")}
                aria-hidden="true"
              />
              <p className="mt-2 text-sm font-semibold leading-5">{preset.label}</p>
              <p className="mt-1 text-[0.7rem] leading-4 text-muted-foreground">
                {preset.summary}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}


/**
 * Shortest acceptable membership code.
 *
 * Card codes are 7 characters (e.g. DXR6W96). The old MB- format was 19, and a
 * leftover `length < 8` check silently rejected every new code — hence one
 * constant rather than a literal at each call site.
 */
export const MIN_MEMBER_CODE_LENGTH = 6
