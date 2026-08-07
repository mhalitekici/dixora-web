"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, Gift, HeartHandshake, Loader2 } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import { loyaltyApi } from "./loyalty-api"
import { loyaltyKeys, useOrderLoyaltyContext } from "./loyalty-hooks"

type OrderItem = {
  id: string
  product_name_snapshot: string
  status: string
}

type StaffLoyaltyPanelProps = {
  orderId: string | null
  items: OrderItem[]
  disabled?: boolean
  compact?: boolean
  onChanged?: () => void
}

export function StaffLoyaltyPanel({
  orderId,
  items,
  disabled = false,
  compact = false,
  onChanged,
}: StaffLoyaltyPanelProps) {
  const queryClient = useQueryClient()
  const contextQuery = useOrderLoyaltyContext(orderId)
  const [membershipCode, setMembershipCode] = useState("")
  const [rewardCode, setRewardCode] = useState("")
  const [orderItemId, setOrderItemId] = useState("")

  const selectedReward = useMemo(
    () =>
      contextQuery.data?.available_rewards.find(
        (reward) => reward.redemption_code === rewardCode,
      ) ?? null,
    [contextQuery.data?.available_rewards, rewardCode],
  )
  const eligibleItems = useMemo(() => {
    const eligibleIds = new Set(selectedReward?.eligible_order_item_ids ?? [])
    return items.filter((item) => eligibleIds.has(item.id))
  }, [items, selectedReward?.eligible_order_item_ids])
  const validOrderItemId = selectedReward?.eligible_order_item_ids.includes(orderItemId)
    ? orderItemId
    : ""

  async function refresh() {
    if (orderId) {
      await queryClient.invalidateQueries({ queryKey: loyaltyKeys.order(orderId) })
    }
    await queryClient.invalidateQueries({ queryKey: loyaltyKeys.rewards })
    onChanged?.()
  }

  const attachMutation = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error("Önce açık bir sipariş seçin.")
      const code = membershipCode.trim().toUpperCase()
      if (code.length < 8) throw new Error("Geçerli üyelik kodunu girin.")
      return loyaltyApi.attachMembership(orderId, code)
    },
    onSuccess: async (result) => {
      setMembershipCode("")
      toast.success("Sadakat üyeliği siparişe bağlandı", {
        description: `${result.program_name} · ${result.membership_code}`,
      })
      await refresh()
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Üyelik bağlanamadı."),
  })

  const redeemMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !selectedReward || !validOrderItemId) {
        throw new Error("Ödül ve uygun sipariş kalemini seçin.")
      }
      return loyaltyApi.redeemReward(selectedReward.redemption_code, {
        order_id: orderId,
        order_item_id: validOrderItemId,
        idempotency_key: `staff-reward:${orderId}:${selectedReward.redemption_code}:${validOrderItemId}`,
      })
    },
    onSuccess: async (result) => {
      toast.success("Sadakat ödülü uygulandı", {
        description: `${result.redemption_code} · ₺${Number(result.amount).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`,
      })
      setRewardCode("")
      setOrderItemId("")
      await refresh()
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Ödül uygulanamadı."),
  })

  const context = contextQuery.data
  const busy = attachMutation.isPending || redeemMutation.isPending

  return (
    <section className="rounded-2xl border bg-card p-3" aria-labelledby={`loyalty-${orderId ?? "empty"}`}>
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <HeartHandshake className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={`loyalty-${orderId ?? "empty"}`} className="text-xs font-semibold">
            Sadakat üyeliği
          </h3>
          <p className="mt-0.5 text-[0.65rem] leading-4 text-muted-foreground">
            {context?.membership_code
              ? `${context.program_name ?? "Program"} · ${context.membership_code}`
              : "Müşterinin üyelik kodunu siparişe bağlayın."}
          </p>
        </div>
        {contextQuery.isFetching ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
      </div>

      {!orderId ? (
        <p className="mt-3 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          Sadakat işlemleri için açık bir sipariş seçin.
        </p>
      ) : contextQuery.isError ? (
        <div className="mt-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">
          Sadakat bilgisi alınamadı. Yetkinizi ve program durumunu kontrol edin.
        </div>
      ) : !context?.membership_code ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            attachMutation.mutate()
          }}
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor={`membership-code-${orderId}`} className="sr-only">
              Üyelik kodu
            </Label>
            <Input
              id={`membership-code-${orderId}`}
              value={membershipCode}
              onChange={(event) => setMembershipCode(event.target.value.toUpperCase())}
              autoComplete="off"
              maxLength={32}
              placeholder="Üyelik kodu"
              className="h-9 rounded-xl font-mono text-xs uppercase"
              disabled={disabled || busy}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="rounded-xl"
            disabled={disabled || busy || membershipCode.trim().length < 8}
          >
            {attachMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Bağla
          </Button>
        </form>
      ) : context.available_rewards.length === 0 ? (
        <p className="mt-3 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
          Bu üyelikte şu anda kullanılabilir ödül yok.
        </p>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div className={compact ? "space-y-2" : "grid gap-2 sm:grid-cols-2"}>
            <div className="space-y-1.5">
              <Label htmlFor={`reward-${orderId}`} className="text-[0.65rem]">
                Kullanılabilir ödül
              </Label>
              <Select
                value={selectedReward?.redemption_code ?? ""}
                onValueChange={(value) => {
                  setRewardCode(value ?? "")
                  setOrderItemId("")
                }}
                disabled={disabled || busy}
              >
                <SelectTrigger id={`reward-${orderId}`} className="w-full rounded-xl">
                  <SelectValue placeholder="Ödül seçin" />
                </SelectTrigger>
                <SelectContent>
                  {context.available_rewards.map((reward) => (
                    <SelectItem key={reward.redemption_code} value={reward.redemption_code}>
                      {reward.description} · {reward.redemption_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`reward-item-${orderId}`} className="text-[0.65rem]">
                Uygulanacak ürün
              </Label>
              <Select
                value={validOrderItemId}
                onValueChange={(value) => setOrderItemId(value ?? "")}
                disabled={disabled || busy || !rewardCode || eligibleItems.length === 0}
              >
                <SelectTrigger id={`reward-item-${orderId}`} className="w-full rounded-xl">
                  <SelectValue placeholder={rewardCode ? "Uygun ürün seçin" : "Önce ödül seçin"} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.product_name_snapshot}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {selectedReward && eligibleItems.length === 0 ? (
            <p className="text-[0.65rem] leading-4 text-amber-700 dark:text-amber-300">
              Bu ödüle uygun ürün siparişte bulunmuyor. Önce ilgili ürünü ekleyin.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full rounded-xl"
            disabled={disabled || busy || !selectedReward || !validOrderItemId}
            onClick={() => redeemMutation.mutate()}
          >
            {redeemMutation.isPending ? <Loader2 className="animate-spin" /> : <Gift />}
            Ödülü siparişe uygula
          </Button>
        </div>
      )}
    </section>
  )
}
