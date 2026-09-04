"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import {
  REWARD_KIND_LABELS,
  type Campaign,
  type CampaignInput,
  type CampaignRewardKind,
  campaignApi,
  campaignKeys,
} from "@/components/campaigns/campaign-api"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Ref = { id: string; name: string }

/** "Bir ürün" vs "bir kategori" — the two ways to name a side of the offer. */
type TargetMode = "PRODUCT" | "CATEGORY"

const REWARD_KINDS: CampaignRewardKind[] = ["FREE_ITEM", "PERCENT", "AMOUNT"]

function useCatalog(open: boolean) {
  return useQuery({
    queryKey: ["campaigns", "catalog"],
    queryFn: async () => {
      const [products, categories, branches] = await Promise.all([
        api.get<{ items: Ref[] }>("catalog/products", { search: { limit: 250 } }),
        api.get<Ref[] | { items: Ref[] }>("catalog/categories"),
        api.get<Array<{ id: string; name: string; is_active: boolean }>>("branches"),
      ])
      return {
        products: products.items,
        categories: Array.isArray(categories) ? categories : categories.items,
        branches: branches.filter((branch) => branch.is_active),
      }
    },
    enabled: open,
  })
}

function TargetPicker({
  idPrefix,
  label,
  mode,
  onModeChange,
  productId,
  categoryId,
  onProductChange,
  onCategoryChange,
  products,
  categories,
}: {
  idPrefix: string
  label: string
  mode: TargetMode
  onModeChange: (mode: TargetMode) => void
  productId: string
  categoryId: string
  onProductChange: (value: string) => void
  onCategoryChange: (value: string) => void
  products: Ref[]
  categories: Ref[]
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={`${idPrefix}-target`}>{label}</Label>
      <div className="flex gap-1.5">
        {(["PRODUCT", "CATEGORY"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onModeChange(value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-xs font-semibold transition-colors",
              mode === value
                ? "border-primary bg-primary/10"
                : "border-transparent bg-muted/70 text-muted-foreground hover:bg-muted",
            )}
          >
            {value === "PRODUCT" ? "Ürün" : "Kategori"}
          </button>
        ))}
      </div>
      {mode === "PRODUCT" ? (
        <Select value={productId} onValueChange={(value) => onProductChange(value ?? "")}>
          <SelectTrigger id={`${idPrefix}-target`} className="w-full rounded-xl">
            <SelectValue placeholder="Ürün seçin" />
          </SelectTrigger>
          <SelectContent>
            {products.map((product) => (
              <SelectItem key={product.id} value={product.id}>
                {product.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Select value={categoryId} onValueChange={(value) => onCategoryChange(value ?? "")}>
          <SelectTrigger id={`${idPrefix}-target`} className="w-full rounded-xl">
            <SelectValue placeholder="Kategori seçin" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

/**
 * The owner writes the offer as a sentence: "buy X, get Y".
 *
 * Kept deliberately away from the loyalty programme screen — loyalty is one
 * long-running stamp card, a campaign is a standalone offer and there can be
 * many live at once.
 */
export function CampaignFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editing: Campaign | null
}) {
  const queryClient = useQueryClient()
  const catalog = useCatalog(open)

  const [name, setName] = useState(editing?.name ?? "")
  const [isActive, setIsActive] = useState(editing?.is_active ?? true)
  const [branchIds, setBranchIds] = useState<string[]>(editing?.branch_ids ?? [])
  const [buyMode, setBuyMode] = useState<TargetMode>(
    editing?.buy_category_id ? "CATEGORY" : "PRODUCT",
  )
  const [buyProductId, setBuyProductId] = useState(editing?.buy_product_id ?? "")
  const [buyCategoryId, setBuyCategoryId] = useState(editing?.buy_category_id ?? "")
  const [buyQuantity, setBuyQuantity] = useState(String(editing?.buy_quantity ?? 1))
  const [rewardKind, setRewardKind] = useState<CampaignRewardKind>(
    editing?.reward_kind ?? "FREE_ITEM",
  )
  const [rewardMode, setRewardMode] = useState<TargetMode>(
    editing?.reward_category_id ? "CATEGORY" : "PRODUCT",
  )
  const [rewardProductId, setRewardProductId] = useState(
    editing?.reward_product_id ?? "",
  )
  const [rewardCategoryId, setRewardCategoryId] = useState(
    editing?.reward_category_id ?? "",
  )
  const [rewardValue, setRewardValue] = useState(editing?.reward_value ?? "0")
  const [maxUses, setMaxUses] = useState(String(editing?.max_uses_per_order ?? 1))

  const products = catalog.data?.products ?? []
  const categories = catalog.data?.categories ?? []
  const branches = catalog.data?.branches ?? []

  const buyChosen = buyMode === "PRODUCT" ? buyProductId : buyCategoryId
  const rewardChosen = rewardMode === "PRODUCT" ? rewardProductId : rewardCategoryId
  const needsValue = rewardKind !== "FREE_ITEM"
  const canSubmit =
    name.trim().length >= 2 &&
    branchIds.length > 0 &&
    Boolean(buyChosen) &&
    Boolean(rewardChosen) &&
    (!needsValue || Number(rewardValue) > 0)

  const saveMutation = useMutation({
    mutationFn: () => {
      const input: CampaignInput = {
        name: name.trim(),
        description: null,
        is_active: isActive,
        branch_ids: branchIds,
        buy_product_id: buyMode === "PRODUCT" ? buyProductId : null,
        buy_category_id: buyMode === "CATEGORY" ? buyCategoryId : null,
        buy_quantity: Number(buyQuantity) || 1,
        minimum_order_amount: "0",
        reward_kind: rewardKind,
        reward_product_id: rewardMode === "PRODUCT" ? rewardProductId : null,
        reward_category_id: rewardMode === "CATEGORY" ? rewardCategoryId : null,
        reward_quantity: 1,
        reward_value: needsValue ? rewardValue : "0",
        audience: "MEMBERS_ONLY",
        max_uses_per_order: Number(maxUses) || 1,
        starts_at: null,
        ends_at: null,
      }
      return editing
        ? campaignApi.update(editing.id, {
            ...input,
            expected_version: editing.version,
          })
        : campaignApi.create(input)
    },
    onSuccess: async (campaign) => {
      toast.success(editing ? "Kampanya güncellendi" : "Kampanya oluşturuldu", {
        description: campaign.summary,
      })
      onOpenChange(false)
      await queryClient.invalidateQueries({ queryKey: campaignKeys.root })
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Kampanya kaydedilemedi."),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Kampanyayı düzenle" : "Yeni kampanya"}</DialogTitle>
          <DialogDescription>
            Kampanyayı bir cümle gibi kurun: şunu alana şunu verin.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="campaign-name">Kampanya adı</Label>
            <Input
              id="campaign-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Örn. Kahve alana tatlı"
              className="h-10 rounded-xl"
            />
          </div>

          <div className="grid gap-4 rounded-2xl border p-3 sm:grid-cols-2">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Şunu alana
              </p>
              <TargetPicker
                idPrefix="buy"
                label="Koşul"
                mode={buyMode}
                onModeChange={setBuyMode}
                productId={buyProductId}
                categoryId={buyCategoryId}
                onProductChange={setBuyProductId}
                onCategoryChange={setBuyCategoryId}
                products={products}
                categories={categories}
              />
              <div className="space-y-1.5">
                <Label htmlFor="campaign-buy-qty">Adet</Label>
                <Input
                  id="campaign-buy-qty"
                  type="number"
                  min={1}
                  value={buyQuantity}
                  onChange={(event) => setBuyQuantity(event.target.value)}
                  className="h-10 rounded-xl"
                />
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Şunu ver
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-reward-kind">İkram türü</Label>
                <Select
                  value={rewardKind}
                  onValueChange={(value) =>
                    setRewardKind((value as CampaignRewardKind) ?? "FREE_ITEM")
                  }
                >
                  <SelectTrigger id="campaign-reward-kind" className="w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REWARD_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {REWARD_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <TargetPicker
                idPrefix="reward"
                label={rewardKind === "FREE_ITEM" ? "İkram" : "İndirim uygulanacak"}
                mode={rewardMode}
                onModeChange={setRewardMode}
                productId={rewardProductId}
                categoryId={rewardCategoryId}
                onProductChange={setRewardProductId}
                onCategoryChange={setRewardCategoryId}
                products={products}
                categories={categories}
              />
              {needsValue ? (
                <div className="space-y-1.5">
                  <Label htmlFor="campaign-reward-value">
                    {rewardKind === "PERCENT" ? "Yüzde (%)" : "Tutar (₺)"}
                  </Label>
                  <Input
                    id="campaign-reward-value"
                    type="number"
                    min={0}
                    value={rewardValue}
                    onChange={(event) => setRewardValue(event.target.value)}
                    className="h-10 rounded-xl"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Kimler yararlanabilir</span>
              <p className="rounded-xl border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                Sadakat üyeleri. Kasiyer ödeme ekranında üyelik kodunu
                girdiğinde uygulanır.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-max-uses">Bir hesapta en fazla</Label>
              <Input
                id="campaign-max-uses"
                type="number"
                min={1}
                value={maxUses}
                onChange={(event) => setMaxUses(event.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Geçerli şubeler</legend>
            <div className="flex flex-wrap gap-3 rounded-xl border p-3">
              {branches.map((branch) => (
                <label
                  key={branch.id}
                  className="flex items-center gap-2 text-sm"
                  htmlFor={`campaign-branch-${branch.id}`}
                >
                  <Checkbox
                    id={`campaign-branch-${branch.id}`}
                    checked={branchIds.includes(branch.id)}
                    onCheckedChange={(checked) =>
                      setBranchIds((current) =>
                        checked
                          ? [...current, branch.id]
                          : current.filter((id) => id !== branch.id),
                      )
                    }
                  />
                  {branch.name}
                </label>
              ))}
              {branches.length === 0 ? (
                <p className="text-xs text-muted-foreground">Şube bulunamadı.</p>
              ) : null}
            </div>
          </fieldset>

          <label
            className="flex items-center justify-between rounded-xl border p-3"
            htmlFor="campaign-active"
          >
            <span className="text-sm font-medium">Kampanya aktif</span>
            <Switch
              id="campaign-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={!canSubmit || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? <Loader2 className="animate-spin" /> : null}
            {editing ? "Kaydet" : "Kampanyayı oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
