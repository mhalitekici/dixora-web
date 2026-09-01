"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Boxes,
  Check,
  ClipboardCheck,
  History,
  Loader2,
  PackageMinus,
  Plus,
  Scale,
  SearchX,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DataToolbar } from "@/components/shared/data-toolbar";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Unit = "piece" | "g" | "kg" | "ml" | "l";
type InventoryItem = {
  id: string;
  name: string;
  sku?: string | null;
  unit: Unit | string;
  current_quantity: string | number;
  minimum_quantity: string | number;
  location_name?: string | null;
  average_cost?: string | number | null;
  is_active: boolean;
};
type InventoryItemResponse = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  current_stock: string | number | null;
  minimum_stock: string | number;
  average_cost?: string | number | null;
  is_active: boolean;
};
type StockMovement = {
  id: string;
  item_id: string;
  item_name?: string;
  movement_type: string;
  quantity: string | number;
  balance_after?: string | number | null;
  reason?: string | null;
  actor_name?: string | null;
  created_at: string;
};
type StockMovementResponse = {
  id: string;
  inventory_item_id: string;
  item_name?: string;
  type: string;
  quantity_delta: string | number;
  balance_after?: string | number | null;
  reason?: string | null;
  actor_user_id?: string | null;
  created_at: string;
};
type Recipe = {
  id: string;
  product_id: string;
  product_name: string;
  yield_quantity: string | number;
  ingredients: Array<{
    inventory_item_id: string;
    name: string;
    quantity: string | number;
    unit: string;
  }>;
};
type CatalogProduct = {
  id: string;
  name: string;
  is_active?: boolean;
};
type RecipeIngredientDraft = {
  key: string;
  inventory_item_id: string;
  quantity: string;
  fallback_name?: string;
  fallback_unit?: string;
};
type RecipePayload = {
  productId: string;
  yieldQuantity: string;
  items: Array<{ inventory_item_id: string; quantity: string }>;
};

type InventoryItemDraft = {
  name: string;
  sku: string;
  unit: "piece" | "gram" | "kilogram" | "milliliter" | "liter";
  minimum_stock: string;
  opening_quantity: string;
};

const EMPTY_ITEMS: InventoryItem[] = [];
const EMPTY_PRODUCTS: CatalogProduct[] = [];
const EMPTY_RECIPES: Recipe[] = [];

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

async function getList<T>(path: string): Promise<T[]> {
  const response = await fetch(`/api/backend${path}`);
  if (!response.ok) throw new Error("Veri alınamadı.");
  return unwrap<T>(await response.json());
}

function normalizeDecimal(value: string) {
  return value.trim().replace(",", ".");
}

function newIngredientDraft(
  inventoryItemId = "",
  quantity = "",
  fallbackName?: string,
  fallbackUnit?: string,
): RecipeIngredientDraft {
  return {
    key: crypto.randomUUID(),
    inventory_item_id: inventoryItemId,
    quantity,
    fallback_name: fallbackName,
    fallback_unit: fallbackUnit,
  };
}

const quantityFormatter = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 3 });
const currency = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });

const unitLabel: Record<string, string> = {
  piece: "adet",
  gram: "g",
  kilogram: "kg",
  milliliter: "ml",
  liter: "L",
  g: "g",
  kg: "kg",
  ml: "ml",
  l: "L",
};

const movementMeta: Record<string, { label: string; tone: Parameters<typeof StatusBadge>[0]["tone"]; icon: typeof ArrowDownLeft }> = {
  PURCHASE: { label: "Satın alma", tone: "success", icon: ArrowDownLeft },
  SALE: { label: "Satış", tone: "info", icon: ArrowUpRight },
  WASTE: { label: "Fire", tone: "danger", icon: PackageMinus },
  ADJUSTMENT: { label: "Düzeltme", tone: "warning", icon: ArrowRightLeft },
  TRANSFER_IN: { label: "Transfer giriş", tone: "success", icon: ArrowDownLeft },
  TRANSFER_OUT: { label: "Transfer çıkış", tone: "info", icon: ArrowUpRight },
  RETURN: { label: "İade", tone: "purple", icon: ArrowDownLeft },
  COUNT_CORRECTION: { label: "Sayım farkı", tone: "warning", icon: ClipboardCheck },
};

export function InventoryManagement() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [inventoryItemDraft, setInventoryItemDraft] = useState<InventoryItemDraft>({
    name: "",
    sku: "",
    unit: "piece",
    minimum_stock: "0",
    opening_quantity: "0",
  });
  const [selectedItem, setSelectedItem] = useState("");
  const [movementType, setMovementType] = useState("ADJUSTMENT");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [recipeProductId, setRecipeProductId] = useState("");
  const [recipeYield, setRecipeYield] = useState("1");
  const [recipeIngredients, setRecipeIngredients] = useState<
    RecipeIngredientDraft[]
  >([]);
  const [recipeFormError, setRecipeFormError] = useState<string | null>(null);

  const itemsQuery = useQuery({
    queryKey: ["inventory", "items"],
    queryFn: async () => {
      const values = await getList<InventoryItemResponse>("/inventory/items");
      return values.map((item) => ({
        id: item.id,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        current_quantity: item.current_stock ?? 0,
        minimum_quantity: item.minimum_stock,
        average_cost: item.average_cost,
        location_name: null,
        is_active: item.is_active,
      }));
    },
  });
  const movementsQuery = useQuery<StockMovement[]>({
    queryKey: ["inventory", "movements"],
    queryFn: async () => {
      const values = await getList<StockMovementResponse>(
        "/inventory/movements?limit=50",
      );
      return values.map((movement) => ({
        id: movement.id,
        item_id: movement.inventory_item_id,
        item_name: movement.item_name,
        movement_type: movement.type,
        quantity: movement.quantity_delta,
        balance_after: movement.balance_after,
        reason: movement.reason,
        actor_name: movement.actor_user_id
          ? `Kullanıcı ${movement.actor_user_id.slice(0, 8)}`
          : "Sistem",
        created_at: movement.created_at,
      }));
    },
  });
  const productsQuery = useQuery({
    queryKey: ["catalog", "products"],
    queryFn: () => getList<CatalogProduct>("/catalog/products?limit=250"),
    staleTime: 30_000,
  });
  const recipesQuery = useQuery({
    queryKey: ["inventory", "recipes"],
    queryFn: () => getList<Recipe>("/inventory/recipes"),
    staleTime: 15_000,
  });

  const items = itemsQuery.data ?? EMPTY_ITEMS;
  const movements = movementsQuery.data ?? [];
  const products = productsQuery.data ?? EMPTY_PRODUCTS;
  const recipes = recipesQuery.data ?? EMPTY_RECIPES;
  const recipeProductIds = useMemo(
    () => new Set(recipes.map((recipe) => recipe.product_id)),
    [recipes],
  );
  const creatableProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          product.is_active !== false && !recipeProductIds.has(product.id),
      ),
    [products, recipeProductIds],
  );
  const recipeDataLoading =
    recipesQuery.isLoading || productsQuery.isLoading || itemsQuery.isLoading;
  const recipeDataError = recipesQuery.error ?? productsQuery.error;
  const lowStockItems = items.filter(
    (item) => Number(item.current_quantity) <= Number(item.minimum_quantity),
  );
  const inventoryValue = items.reduce(
    (sum, item) => sum + Number(item.current_quantity) * Number(item.average_cost ?? 0),
    0,
  );

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const text = `${item.name} ${item.sku ?? ""}`.toLocaleLowerCase("tr-TR");
        const matchesSearch = text.includes(search.toLocaleLowerCase("tr-TR"));
        const matchesFilter =
          stockFilter === "all" ||
          (stockFilter === "low" &&
            Number(item.current_quantity) <= Number(item.minimum_quantity)) ||
          (stockFilter === "healthy" &&
            Number(item.current_quantity) > Number(item.minimum_quantity));
        return matchesSearch && matchesFilter;
      }),
    [items, search, stockFilter],
  );

  const adjustmentMutation = useMutation({
    mutationFn: async () => {
      const numericQuantity = Number(quantity);
      const quantityDelta =
        movementType === "WASTE"
          ? -Math.abs(numericQuantity)
          : movementType === "PURCHASE" || movementType === "RETURN"
            ? Math.abs(numericQuantity)
            : numericQuantity;
      const response = await fetch("/api/backend/inventory/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventory_item_id: selectedItem,
          type: movementType,
          quantity_delta: quantityDelta,
          reason,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      const data = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) throw new Error(data?.detail ?? "Stok hareketi kaydedilemedi.");
    },
    onSuccess: () => {
      toast.success("Stok hareketi kaydedildi", {
        description: "Yeni bakiye ve denetim kaydı oluşturuldu.",
      });
      setDialogOpen(false);
      setQuantity("");
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "İşlem başarısız."),
  });

  const createItemMutation = useMutation({
    mutationFn: async (draft: InventoryItemDraft) => {
      const response = await fetch("/api/backend/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          sku: draft.sku.trim() || null,
          unit: draft.unit,
          minimum_stock: normalizeDecimal(draft.minimum_stock),
          opening_quantity: normalizeDecimal(draft.opening_quantity),
        }),
      });
      const data = (await response.json().catch(() => null)) as { detail?: string } | null;
      if (!response.ok) {
        throw new Error(data?.detail ?? "Stok kartı oluşturulamadı.");
      }
    },
    onSuccess: () => {
      toast.success("Stok kartı oluşturuldu.");
      setItemDialogOpen(false);
      setInventoryItemDraft({
        name: "",
        sku: "",
        unit: "piece",
        minimum_stock: "0",
        opening_quantity: "0",
      });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Stok kartı oluşturulamadı."),
  });

  const recipeMutation = useMutation({
    mutationFn: async (payload: RecipePayload) => {
      const response = await fetch(
        `/api/backend/inventory/recipes/${payload.productId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            product_id: payload.productId,
            yield_quantity: payload.yieldQuantity,
            items: payload.items,
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | {
              detail?: string;
              message?: string;
              error?: { message?: string };
            }
          | null;
        throw new Error(
          data?.error?.message ??
            data?.detail ??
            data?.message ??
            "Reçete kaydedilemedi.",
        );
      }
    },
    onSuccess: async () => {
      toast.success(
        editingRecipe ? "Reçete güncellendi" : "Yeni reçete kaydedildi",
        {
          description:
            "Ürün satışlarında kullanılacak stok düşüm bilgileri yenilendi.",
        },
      );
      setRecipeDialogOpen(false);
      setEditingRecipe(null);
      setRecipeFormError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory", "recipes"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", "items"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog", "products"] }),
      ]);
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message : "Reçete kaydedilemedi.";
      setRecipeFormError(message);
      toast.error(message);
    },
  });

  function openCreateRecipe() {
    const product = creatableProducts[0];
    if (!product) {
      toast.info("Reçetesiz aktif ürün bulunmuyor.");
      return;
    }
    setEditingRecipe(null);
    setRecipeProductId(product.id);
    setRecipeYield("1");
    setRecipeIngredients([
      newIngredientDraft(items[0]?.id ?? "", ""),
    ]);
    setRecipeFormError(null);
    setRecipeDialogOpen(true);
  }

  function openEditRecipe(recipe: Recipe) {
    setEditingRecipe(recipe);
    setRecipeProductId(recipe.product_id);
    setRecipeYield(String(recipe.yield_quantity));
    setRecipeIngredients(
      recipe.ingredients.length
        ? recipe.ingredients.map((ingredient) =>
            newIngredientDraft(
              ingredient.inventory_item_id,
              String(ingredient.quantity),
              ingredient.name,
              ingredient.unit,
            ),
          )
        : [newIngredientDraft(items[0]?.id ?? "", "")],
    );
    setRecipeFormError(null);
    setRecipeDialogOpen(true);
  }

  function updateRecipeIngredient(
    key: string,
    field: "inventory_item_id" | "quantity",
    value: string,
  ) {
    setRecipeIngredients((current) =>
      current.map((ingredient) =>
        ingredient.key === key
          ? { ...ingredient, [field]: value }
          : ingredient,
      ),
    );
    setRecipeFormError(null);
  }

  function addRecipeIngredient() {
    const selectedIds = new Set(
      recipeIngredients.map((ingredient) => ingredient.inventory_item_id),
    );
    const nextItem = items.find((item) => !selectedIds.has(item.id));
    setRecipeIngredients((current) => [
      ...current,
      newIngredientDraft(nextItem?.id ?? "", ""),
    ]);
    setRecipeFormError(null);
  }

  function removeRecipeIngredient(key: string) {
    setRecipeIngredients((current) =>
      current.filter((ingredient) => ingredient.key !== key),
    );
    setRecipeFormError(null);
  }

  function submitRecipe() {
    const normalizedYield = normalizeDecimal(recipeYield);
    if (!recipeProductId) {
      setRecipeFormError("Reçetenin bağlanacağı ürünü seçin.");
      return;
    }
    if (!Number.isFinite(Number(normalizedYield)) || Number(normalizedYield) <= 0) {
      setRecipeFormError("Porsiyon/verim miktarı sıfırdan büyük olmalı.");
      return;
    }
    if (recipeIngredients.length === 0) {
      setRecipeFormError("En az bir reçete bileşeni ekleyin.");
      return;
    }

    const itemIds = recipeIngredients.map(
      (ingredient) => ingredient.inventory_item_id,
    );
    if (itemIds.some((id) => !id)) {
      setRecipeFormError("Her satır için bir stok kartı seçin.");
      return;
    }
    if (new Set(itemIds).size !== itemIds.length) {
      setRecipeFormError("Aynı stok kartı reçeteye birden fazla kez eklenemez.");
      return;
    }

    const normalizedItems = recipeIngredients.map((ingredient) => ({
      inventory_item_id: ingredient.inventory_item_id,
      quantity: normalizeDecimal(ingredient.quantity),
    }));
    if (
      normalizedItems.some(
        (item) =>
          !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0,
      )
    ) {
      setRecipeFormError("Tüm bileşen miktarları sıfırdan büyük olmalı.");
      return;
    }

    setRecipeFormError(null);
    recipeMutation.mutate({
      productId: recipeProductId,
      yieldQuantity: normalizedYield,
      items: normalizedItems,
    });
  }

  const inventoryDataLoading =
    itemsQuery.isLoading || movementsQuery.isLoading;
  const inventoryDataError = itemsQuery.error ?? movementsQuery.error;
  const inventoryDataFetching =
    itemsQuery.isFetching || movementsQuery.isFetching;

  if (inventoryDataLoading) {
    return (
      <>
        <PageHeader
          eyebrow="Şube bazlı stok"
          title="Envanter"
          description="Güncel bakiyeleri, düşük stok risklerini, reçeteleri ve değiştirilemez hareket geçmişini yönetin."
          icon={Boxes}
        />
        <div className="flex min-h-72 items-center justify-center" role="status">
          <Loader2 className="size-6 animate-spin text-brand" />
          <span className="sr-only">Envanter yükleniyor</span>
        </div>
      </>
    );
  }

  if (inventoryDataError) {
    return (
      <>
        <PageHeader
          eyebrow="Şube bazlı stok"
          title="Envanter"
          description="Güncel bakiyeleri, düşük stok risklerini, reçeteleri ve değiştirilemez hareket geçmişini yönetin."
          icon={Boxes}
        />
        <EmptyState
          title="Envanter yüklenemedi"
          description="Stok kartlarına veya hareket geçmişine ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin."
          icon={AlertTriangle}
          action={
            <Button
              variant="outline"
              disabled={inventoryDataFetching}
              onClick={() => {
                void Promise.all([
                  itemsQuery.refetch(),
                  movementsQuery.refetch(),
                ]);
              }}
            >
              {inventoryDataFetching ? (
                <Loader2 className="animate-spin" />
              ) : (
                <History />
              )}
              Yeniden dene
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Şube bazlı stok"
        title="Envanter"
        description="Güncel bakiyeleri, düşük stok risklerini, reçeteleri ve değiştirilemez hareket geçmişini yönetin."
        icon={Boxes}
        actions={
          <>
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={() => setItemDialogOpen(true)}
            >
              <Plus />
              Stok kartı ekle
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              disabled
              title="Döngüsel sayım iş akışı sonraki kapsamda etkinleştirilecek."
            >
              <ClipboardCheck />
              Sayım · yakında
            </Button>
            <Button
              className="h-10 rounded-xl"
              disabled={items.length === 0}
              onClick={() => {
                setSelectedItem(items[0]?.id ?? "");
                setDialogOpen(true);
              }}
            >
              <Plus />
              Stok hareketi
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Stok kartı" value={items.length} detail="Şube envanteri" icon={Boxes} tone="brand" />
        <StatCard title="Düşük stok" value={lowStockItems.length} detail="Siparişi etkileyebilir" icon={AlertTriangle} tone="warning" />
        <StatCard title="Tahmini değer" value={currency.format(inventoryValue)} detail="Ortalama maliyetle" icon={Scale} tone="info" />
        <StatCard title="Bugünkü hareket" value={movements.length} detail="Satış, fire ve düzeltme" icon={History} tone="success" />
      </div>

      <Tabs defaultValue="balances" className="gap-4">
        <TabsList className="h-10 rounded-xl">
          <TabsTrigger value="balances" className="h-8 px-3">
            <Boxes />
            Bakiyeler
          </TabsTrigger>
          <TabsTrigger value="movements" className="h-8 px-3">
            <History />
            Hareketler
          </TabsTrigger>
          <TabsTrigger value="recipes" className="h-8 px-3">
            <UtensilsCrossed />
            Reçeteler
          </TabsTrigger>
        </TabsList>

        <TabsContent value="balances">
          <DataToolbar
            value={search}
            onValueChange={setSearch}
            placeholder="Stok kartı veya SKU ara…"
            filters={
              <Select value={stockFilter} onValueChange={(value) => setStockFilter(value ?? "all")}>
                <SelectTrigger className="h-10 min-w-40 rounded-xl">
                  <SelectValue placeholder="Tüm stoklar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tüm stoklar</SelectItem>
                  <SelectItem value="low">Düşük stok</SelectItem>
                  <SelectItem value="healthy">Yeterli stok</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
            {itemsQuery.isLoading ? (
              <div className="flex min-h-64 items-center justify-center">
                <Loader2 className="size-6 animate-spin text-brand" />
              </div>
            ) : filteredItems.length ? (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead>Stok kartı</TableHead>
                    <TableHead>Konum</TableHead>
                    <TableHead>Güncel bakiye</TableHead>
                    <TableHead className="hidden md:table-cell">Minimum</TableHead>
                    <TableHead className="hidden lg:table-cell">Ort. maliyet</TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const current = Number(item.current_quantity);
                    const minimum = Number(item.minimum_quantity);
                    const isLow = current <= minimum;
                    const ratio = minimum > 0 ? Math.min(100, (current / minimum) * 100) : 100;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                "flex size-10 items-center justify-center rounded-xl",
                                isLow
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              {isLow ? <AlertTriangle className="size-4" /> : <Boxes className="size-4" />}
                            </span>
                            <div>
                              <p className="text-sm font-semibold">{item.name}</p>
                              <p className="text-[0.65rem] text-muted-foreground">{item.sku ?? "SKU yok"}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.location_name ?? "Konum belirtilmemiş"}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold tabular-nums">
                            {quantityFormatter.format(current)} {unitLabel[item.unit] ?? item.unit}
                          </p>
                          <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full", isLow ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-xs md:table-cell">
                          {quantityFormatter.format(minimum)} {unitLabel[item.unit] ?? item.unit}
                        </TableCell>
                        <TableCell className="hidden text-xs lg:table-cell">
                          {item.average_cost
                            ? `${currency.format(Number(item.average_cost))} / ${unitLabel[item.unit] ?? item.unit}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={isLow ? "warning" : "success"}>
                            {isLow ? "Düşük" : "Yeterli"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg"
                            onClick={() => {
                              setSelectedItem(item.id);
                              setDialogOpen(true);
                            }}
                          >
                            Düzelt
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="p-4">
                <EmptyState
                  title="Stok kartı bulunamadı"
                  description="Filtreleri temizleyin veya yeni bir stok kartı ekleyin."
                  icon={SearchX}
                />
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="movements">
          <div className="overflow-hidden rounded-2xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Tarih</TableHead>
                  <TableHead>Stok kartı</TableHead>
                  <TableHead>Hareket</TableHead>
                  <TableHead>Miktar</TableHead>
                  <TableHead className="hidden md:table-cell">Bakiye</TableHead>
                  <TableHead className="hidden lg:table-cell">Kullanıcı / neden</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => {
                  const meta = movementMeta[movement.movement_type] ?? movementMeta.ADJUSTMENT;
                  return (
                    <TableRow key={movement.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("tr-TR", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(movement.created_at))}
                      </TableCell>
                      <TableCell className="text-sm font-semibold">{movement.item_name ?? movement.item_id}</TableCell>
                      <TableCell>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          Number(movement.quantity) < 0 ? "text-destructive" : "text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {Number(movement.quantity) > 0 ? "+" : ""}
                        {movement.quantity}
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell">{movement.balance_after ?? "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <p className="text-xs">{movement.actor_name ?? "Sistem"}</p>
                        <p className="text-[0.65rem] text-muted-foreground">{movement.reason ?? "Sipariş yaşam döngüsü"}</p>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {movements.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-32 text-center text-sm text-muted-foreground"
                    >
                      Henüz stok hareketi bulunmuyor.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="recipes">
          <div className="mb-4 flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Ürün reçeteleri</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Bir ürün satıldığında düşülecek stok kartlarını ve miktarlarını
                tanımlayın.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!recipeDataLoading &&
              !recipeDataError &&
              creatableProducts.length === 0 &&
              products.length > 0 ? (
                <StatusBadge tone="success">Tüm ürünler tanımlı</StatusBadge>
              ) : null}
              <Button
                className="rounded-xl"
                disabled={
                  recipeDataLoading ||
                  Boolean(recipeDataError) ||
                  items.length === 0 ||
                  creatableProducts.length === 0
                }
                title={
                  items.length === 0
                      ? "Önce en az bir stok kartı oluşturun."
                      : creatableProducts.length === 0
                        ? "Tüm aktif ürünler için reçete tanımlı."
                        : undefined
                }
                onClick={openCreateRecipe}
              >
                <Plus />
                Yeni reçete
              </Button>
            </div>
          </div>

          {recipeDataLoading ? (
            <div className="flex min-h-64 items-center justify-center rounded-2xl border bg-card">
              <Loader2 className="size-6 animate-spin text-brand" />
            </div>
          ) : recipeDataError ? (
            <EmptyState
              title="Reçeteler yüklenemedi"
              description={
                recipeDataError instanceof Error
                  ? recipeDataError.message
                  : "Ürün kataloğu veya reçete verisi alınamadı."
              }
              icon={AlertTriangle}
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    void recipesQuery.refetch();
                    void productsQuery.refetch();
                  }}
                >
                  Tekrar dene
                </Button>
              }
            />
          ) : recipes.length === 0 ? (
            <EmptyState
              title={
                products.length === 0
                  ? "Katalogda ürün bulunmuyor"
                  : "Henüz reçete tanımlanmadı"
              }
              description={
                products.length === 0
                  ? "Reçete oluşturmadan önce kataloğa en az bir aktif ürün ekleyin."
                  : items.length === 0
                    ? "Reçete oluşturmadan önce en az bir stok kartı ekleyin."
                    : "İlk ürün reçetesini oluşturarak otomatik stok düşümünü başlatın."
              }
              icon={UtensilsCrossed}
              action={
                products.length > 0 && items.length > 0 ? (
                  <Button onClick={openCreateRecipe}>
                    <Plus />
                    Yeni reçete
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {recipes.map((recipe) => (
                <article key={recipe.id} className="rounded-2xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-3 border-b pb-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                        <UtensilsCrossed className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">
                          {recipe.product_name}
                        </h3>
                        <p className="text-[0.66rem] text-muted-foreground">
                          {quantityFormatter.format(
                            Number(recipe.yield_quantity),
                          )}{" "}
                          porsiyonluk stok düşümü
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={
                        (items.length === 0 && recipe.ingredients.length === 0)
                      }
                      onClick={() => openEditRecipe(recipe)}
                    >
                      Düzenle
                    </Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {recipe.ingredients.length ? (
                      recipe.ingredients.map((ingredient) => (
                        <div
                          key={`${ingredient.inventory_item_id}-${ingredient.name}`}
                          className="flex items-center justify-between gap-3 rounded-xl bg-muted/45 px-3 py-2"
                        >
                          <span className="truncate text-xs">
                            {ingredient.name}
                          </span>
                          <span className="shrink-0 text-xs font-semibold tabular-nums">
                            {quantityFormatter.format(
                              Number(ingredient.quantity),
                            )}{" "}
                            {unitLabel[ingredient.unit] ?? ingredient.unit}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-xl bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                        Bu reçetede bileşen bulunmuyor.
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stok hareketi kaydet</DialogTitle>
            <DialogDescription>
              Hareket geri yazılmaz; düzeltme gerekiyorsa yeni bir ters kayıt oluşturulur.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Stok kartı</Label>
              <Select value={selectedItem} onValueChange={(value) => setSelectedItem(value ?? "")}>
                <SelectTrigger className="h-11 w-full rounded-xl">
                  <SelectValue placeholder="Stok kartı seçin" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Hareket tipi</Label>
                <Select value={movementType} onValueChange={(value) => setMovementType(value ?? "ADJUSTMENT")}>
                  <SelectTrigger className="h-11 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PURCHASE">Satın alma</SelectItem>
                    <SelectItem value="WASTE">Fire</SelectItem>
                    <SelectItem value="ADJUSTMENT">Manuel düzeltme</SelectItem>
                    <SelectItem value="RETURN">İade</SelectItem>
                    <SelectItem value="COUNT_CORRECTION">Sayım farkı</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="movement-quantity">Miktar</Label>
                <Input
                  id="movement-quantity"
                  inputMode="decimal"
                  className="h-11 rounded-xl"
                  placeholder="-1.5 veya 10"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="movement-reason">Neden</Label>
              <Textarea
                id="movement-reason"
                className="rounded-xl"
                rows={3}
                placeholder="Denetim kaydı için açıklama…"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div className="flex gap-3 rounded-xl bg-amber-500/8 p-3 text-xs leading-5 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Negatif stok politikası ve yetkili override kuralları API tarafından doğrulanır.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={!selectedItem || !quantity || !reason.trim() || adjustmentMutation.isPending}
              onClick={() => adjustmentMutation.mutate()}
            >
              {adjustmentMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              Hareketi kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={itemDialogOpen}
        onOpenChange={(open) => !createItemMutation.isPending && setItemDialogOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stok kartı ekle</DialogTitle>
            <DialogDescription>
              Malzeme veya satılabilir ürüne ait başlangıç stoğunu tanımlayın.
            </DialogDescription>
          </DialogHeader>
          <form
            id="inventory-item-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              createItemMutation.mutate(inventoryItemDraft);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="inventory-item-name">Stok adı</Label>
              <Input
                id="inventory-item-name"
                className="h-11 rounded-xl"
                placeholder="Dana kıyma"
                value={inventoryItemDraft.name}
                onChange={(event) =>
                  setInventoryItemDraft((current) => ({ ...current, name: event.target.value }))
                }
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inventory-item-sku">Stok kodu</Label>
              <Input
                id="inventory-item-sku"
                className="h-11 rounded-xl"
                placeholder="KIRMA-001"
                value={inventoryItemDraft.sku}
                onChange={(event) =>
                  setInventoryItemDraft((current) => ({ ...current, sku: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Birim</Label>
                <Select
                  items={[
                    { value: "piece", label: "Adet" },
                    { value: "gram", label: "Gram" },
                    { value: "kilogram", label: "Kilogram" },
                    { value: "milliliter", label: "Mililitre" },
                    { value: "liter", label: "Litre" },
                  ]}
                  value={inventoryItemDraft.unit}
                  onValueChange={(value) =>
                    setInventoryItemDraft((current) => ({
                      ...current,
                      unit: (value ?? "piece") as InventoryItemDraft["unit"],
                    }))
                  }
                >
                  <SelectTrigger className="h-11 w-full rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="piece">Adet</SelectItem>
                    <SelectItem value="gram">Gram</SelectItem>
                    <SelectItem value="kilogram">Kilogram</SelectItem>
                    <SelectItem value="milliliter">Mililitre</SelectItem>
                    <SelectItem value="liter">Litre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventory-minimum-stock">Minimum</Label>
                <Input
                  id="inventory-minimum-stock"
                  inputMode="decimal"
                  className="h-11 rounded-xl"
                  value={inventoryItemDraft.minimum_stock}
                  onChange={(event) =>
                    setInventoryItemDraft((current) => ({ ...current, minimum_stock: event.target.value }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventory-opening-quantity">Açılış</Label>
                <Input
                  id="inventory-opening-quantity"
                  inputMode="decimal"
                  className="h-11 rounded-xl"
                  value={inventoryItemDraft.opening_quantity}
                  onChange={(event) =>
                    setInventoryItemDraft((current) => ({ ...current, opening_quantity: event.target.value }))
                  }
                  required
                />
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={createItemMutation.isPending}
              onClick={() => setItemDialogOpen(false)}
            >
              Vazgeç
            </Button>
            <Button
              type="submit"
              form="inventory-item-form"
              disabled={
                createItemMutation.isPending ||
                !inventoryItemDraft.name.trim() ||
                !Number.isFinite(Number(normalizeDecimal(inventoryItemDraft.minimum_stock))) ||
                !Number.isFinite(Number(normalizeDecimal(inventoryItemDraft.opening_quantity))) ||
                Number(normalizeDecimal(inventoryItemDraft.minimum_stock)) < 0 ||
                Number(normalizeDecimal(inventoryItemDraft.opening_quantity)) < 0
              }
            >
              {createItemMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              Stok kartını kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={recipeDialogOpen}
        onOpenChange={(open) => {
          if (recipeMutation.isPending) return;
          setRecipeDialogOpen(open);
          if (!open) {
            setEditingRecipe(null);
            setRecipeFormError(null);
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingRecipe
                ? `${editingRecipe.product_name} reçetesini düzenle`
                : "Yeni ürün reçetesi"}
            </DialogTitle>
            <DialogDescription>
              Verim miktarını ve bu miktar için stoktan düşülecek bileşenleri
              tanımlayın.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              submitRecipe();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-2">
                <Label htmlFor="recipe-product">Ürün</Label>
                <Select
                  value={recipeProductId}
                  disabled={Boolean(editingRecipe)}
                  onValueChange={(value) => {
                    setRecipeProductId(value ?? "");
                    setRecipeFormError(null);
                  }}
                >
                  <SelectTrigger
                    id="recipe-product"
                    className="h-11 w-full rounded-xl"
                  >
                    <SelectValue placeholder="Katalogdan ürün seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {editingRecipe &&
                    !products.some(
                      (product) => product.id === editingRecipe.product_id,
                    ) ? (
                      <SelectItem value={editingRecipe.product_id}>
                        {editingRecipe.product_name}
                      </SelectItem>
                    ) : null}
                    {(editingRecipe
                      ? products.filter(
                          (product) => product.id === editingRecipe.product_id,
                        )
                      : creatableProducts
                    ).map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {editingRecipe ? (
                  <p className="text-[0.66rem] text-muted-foreground">
                    Ürün bağlantısı mevcut reçetede değiştirilemez.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipe-yield">Porsiyon / verim</Label>
                <Input
                  id="recipe-yield"
                  inputMode="decimal"
                  className="h-11 rounded-xl"
                  placeholder="1"
                  value={recipeYield}
                  onChange={(event) => {
                    setRecipeYield(event.target.value);
                    setRecipeFormError(null);
                  }}
                />
                <p className="text-[0.66rem] text-muted-foreground">
                  Aşağıdaki miktarların ürettiği porsiyon.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label>Reçete bileşenleri</Label>
                  <p className="mt-1 text-[0.66rem] text-muted-foreground">
                    Her stok kartı bir kez eklenebilir.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg"
                  disabled={items.every((item) =>
                    recipeIngredients.some(
                      (ingredient) => ingredient.inventory_item_id === item.id,
                    ),
                  )}
                  onClick={addRecipeIngredient}
                >
                  <Plus />
                  Bileşen ekle
                </Button>
              </div>

              <div className="space-y-2">
                {recipeIngredients.map((ingredient, index) => {
                  const selectedInventoryItem = items.find(
                    (item) => item.id === ingredient.inventory_item_id,
                  );
                  const selectedByOtherRows = new Set(
                    recipeIngredients
                      .filter((item) => item.key !== ingredient.key)
                      .map((item) => item.inventory_item_id),
                  );
                  return (
                    <div
                      key={ingredient.key}
                      className="grid gap-2 rounded-xl border bg-muted/25 p-3 sm:grid-cols-[minmax(0,1fr)_150px_auto] sm:items-start"
                    >
                      <div className="space-y-1.5">
                        <Label
                          htmlFor={`recipe-ingredient-${ingredient.key}`}
                          className="text-[0.68rem]"
                        >
                          {index + 1}. stok kartı
                        </Label>
                        <Select
                          value={ingredient.inventory_item_id}
                          onValueChange={(value) =>
                            updateRecipeIngredient(
                              ingredient.key,
                              "inventory_item_id",
                              value ?? "",
                            )
                          }
                        >
                          <SelectTrigger
                            id={`recipe-ingredient-${ingredient.key}`}
                            className="h-10 w-full rounded-lg bg-card"
                          >
                            <SelectValue placeholder="Stok kartı seçin" />
                          </SelectTrigger>
                          <SelectContent>
                            {!selectedInventoryItem &&
                            ingredient.inventory_item_id ? (
                              <SelectItem value={ingredient.inventory_item_id}>
                                {ingredient.fallback_name ??
                                  "Arşivlenmiş stok kartı"}
                              </SelectItem>
                            ) : null}
                            {items.map((item) => (
                              <SelectItem
                                key={item.id}
                                value={item.id}
                                disabled={selectedByOtherRows.has(item.id)}
                              >
                                {item.name} · {unitLabel[item.unit] ?? item.unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label
                          htmlFor={`recipe-quantity-${ingredient.key}`}
                          className="text-[0.68rem]"
                        >
                          Miktar
                        </Label>
                        <Input
                          id={`recipe-quantity-${ingredient.key}`}
                          inputMode="decimal"
                          className="h-10 rounded-lg bg-card"
                          placeholder="0,00"
                          value={ingredient.quantity}
                          onChange={(event) =>
                            updateRecipeIngredient(
                              ingredient.key,
                              "quantity",
                              event.target.value,
                            )
                          }
                        />
                        <p className="text-[0.62rem] text-muted-foreground">
                          {selectedInventoryItem
                            ? unitLabel[selectedInventoryItem.unit] ??
                              selectedInventoryItem.unit
                            : ingredient.fallback_unit
                              ? unitLabel[ingredient.fallback_unit] ??
                                ingredient.fallback_unit
                              : "Birim seçime göre gelir"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="mt-6 text-muted-foreground hover:text-destructive"
                        aria-label={`${index + 1}. bileşeni kaldır`}
                        disabled={recipeIngredients.length === 1}
                        onClick={() => removeRecipeIngredient(ingredient.key)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            {recipeFormError ? (
              <div
                role="alert"
                className="flex gap-3 rounded-xl bg-destructive/8 p-3 text-xs leading-5 text-destructive"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {recipeFormError}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={recipeMutation.isPending}
                onClick={() => setRecipeDialogOpen(false)}
              >
                Vazgeç
              </Button>
              <Button type="submit" disabled={recipeMutation.isPending}>
                {recipeMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Check />
                )}
                {editingRecipe ? "Reçeteyi güncelle" : "Reçeteyi kaydet"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
