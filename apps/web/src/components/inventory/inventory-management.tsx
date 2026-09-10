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
  Copy,
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
import { useAccessibleBranches } from "@/hooks/use-auth";
import { RecipeCopyDialog } from "@/components/inventory/recipe-copy-dialog";

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
  unit: string;
  fallback_name?: string;
  fallback_unit?: string;
};
type RecipePayload = {
  productId: string;
  yieldQuantity: string;
  items: Array<{ inventory_item_id: string; quantity: string; unit: string }>;
};
type BrandStockOverview = {
  branches: Array<{ id: string; name: string }>;
  items: Array<{
    key: string;
    name: string;
    sku?: string | null;
    category?: string | null;
    unit: string;
    branches: Array<{
      branch_id: string;
      branch_name: string;
      inventory_item_id: string;
      quantity: string | number;
      minimum_stock: string | number;
      target_stock: string | number;
      status: "NORMAL" | "LOW" | "OUT_OF_STOCK";
    }>;
  }>;
  total_items: number;
  low_count: number;
  out_of_stock_count: number;
};

type InventoryItemDraft = {
  name: string;
  sku: string;
  category: string;
  unit: "piece" | "gram" | "kilogram" | "milliliter" | "liter";
  minimum_stock: string;
  target_stock: string;
  opening_quantity: string;
};

const EMPTY_ITEMS: InventoryItem[] = [];
const EMPTY_PRODUCTS: CatalogProduct[] = [];
const EMPTY_RECIPES: Recipe[] = [];

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (
    value &&
    typeof value === "object" &&
    Array.isArray((value as { items?: unknown }).items)
  ) {
    return (value as { items: T[] }).items;
  }
  return [];
}

async function getList<T>(path: string): Promise<T[]> {
  const response = await fetch(`/api/backend${path}`);
  if (!response.ok) throw new Error("Veri alınamadı.");
  return unwrap<T>(await response.json());
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`/api/backend${path}`);
  if (!response.ok) throw new Error("Veri alınamadı.");
  return response.json() as Promise<T>;
}

function normalizeDecimal(value: string) {
  return value.trim().replace(",", ".");
}

function newIngredientDraft(
  inventoryItemId = "",
  quantity = "",
  unit = "piece",
  fallbackName?: string,
  fallbackUnit?: string,
): RecipeIngredientDraft {
  return {
    key: crypto.randomUUID(),
    inventory_item_id: inventoryItemId,
    quantity,
    unit,
    fallback_name: fallbackName,
    fallback_unit: fallbackUnit,
  };
}

const quantityFormatter = new Intl.NumberFormat("tr-TR", {
  maximumFractionDigits: 3,
});
const currency = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 2,
});

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

const compatibleRecipeUnits: Record<string, string[]> = {
  piece: ["piece"],
  gram: ["gram", "kilogram"],
  kilogram: ["gram", "kilogram"],
  milliliter: ["milliliter", "liter"],
  liter: ["milliliter", "liter"],
};

function defaultRecipeUnit(stockUnit: string) {
  if (stockUnit === "kilogram") return "gram";
  if (stockUnit === "liter") return "milliliter";
  return stockUnit;
}

const movementMeta: Record<
  string,
  {
    label: string;
    tone: Parameters<typeof StatusBadge>[0]["tone"];
    icon: typeof ArrowDownLeft;
  }
> = {
  PURCHASE: { label: "Satın alma", tone: "success", icon: ArrowDownLeft },
  SALE: { label: "Satış", tone: "info", icon: ArrowUpRight },
  WASTE: { label: "Fire", tone: "danger", icon: PackageMinus },
  ADJUSTMENT: { label: "Düzeltme", tone: "warning", icon: ArrowRightLeft },
  TRANSFER_IN: {
    label: "Transfer giriş",
    tone: "success",
    icon: ArrowDownLeft,
  },
  TRANSFER_OUT: { label: "Transfer çıkış", tone: "info", icon: ArrowUpRight },
  RETURN: { label: "İade", tone: "purple", icon: ArrowDownLeft },
  COUNT_CORRECTION: {
    label: "Sayım farkı",
    tone: "warning",
    icon: ClipboardCheck,
  },
};

export function InventoryManagement() {
  const queryClient = useQueryClient();
  const accessibleBranches = useAccessibleBranches();
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferSource, setTransferSource] = useState("");
  const [transferTarget, setTransferTarget] = useState("");
  const [transferQuantity, setTransferQuantity] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [inventoryItemDraft, setInventoryItemDraft] =
    useState<InventoryItemDraft>({
      name: "",
      sku: "",
      category: "",
      unit: "piece",
      minimum_stock: "0",
      target_stock: "0",
      opening_quantity: "0",
    });
  const [selectedItem, setSelectedItem] = useState("");
  const [movementType, setMovementType] = useState("ADJUSTMENT");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [recipeCopyDialogOpen, setRecipeCopyDialogOpen] = useState(false);
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
  const overviewQuery = useQuery({
    queryKey: ["inventory", "overview"],
    queryFn: () => getJson<BrandStockOverview>("/inventory/overview"),
  });
  const transferOptions = (overviewQuery.data?.items ?? []).flatMap((item) =>
    item.branches.map((cell) => ({ item, cell })),
  );
  const selectedTransferSource = transferOptions.find(
    ({ cell }) => cell.inventory_item_id === transferSource,
  );
  const compatibleTransferTargets = selectedTransferSource
    ? selectedTransferSource.item.branches.filter(
        (cell) => cell.branch_id !== selectedTransferSource.cell.branch_id,
      )
    : [];
  const overviewCategories = Array.from(
    new Set(
      (overviewQuery.data?.items ?? [])
        .map((item) => item.category)
        .filter((category): category is string => Boolean(category)),
    ),
  ).sort((left, right) => left.localeCompare(right, "tr"));
  const visibleOverviewBranches = (overviewQuery.data?.branches ?? []).filter(
    (branch) => branchFilter === "all" || branch.id === branchFilter,
  );
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
  const filteredItems = useMemo(
    () =>
      items
        .filter((item) => {
          const text = `${item.name} ${item.sku ?? ""}`.toLocaleLowerCase(
            "tr-TR",
          );
          const matchesSearch = text.includes(
            search.toLocaleLowerCase("tr-TR"),
          );
          const matchesFilter =
            stockFilter === "all" ||
            (stockFilter === "low" &&
              Number(item.current_quantity) <= Number(item.minimum_quantity)) ||
            (stockFilter === "healthy" &&
              Number(item.current_quantity) > Number(item.minimum_quantity));
          return matchesSearch && matchesFilter;
        })
        .sort((left, right) => {
          const statusRank = (item: InventoryItem) => {
            const current = Number(item.current_quantity);
            if (current <= 0) return 0;
            if (current <= Number(item.minimum_quantity)) return 1;
            return 2;
          };
          return (
            statusRank(left) - statusRank(right) ||
            left.name.localeCompare(right.name, "tr")
          );
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
      const data = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
      if (!response.ok)
        throw new Error(data?.detail ?? "Stok hareketi kaydedilemedi.");
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
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "İşlem başarısız."),
  });
  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTransferSource)
        throw new Error("Kaynak stok kartını seçin.");
      const target = compatibleTransferTargets.find(
        (cell) => cell.inventory_item_id === transferTarget,
      );
      if (!target) throw new Error("Hedef şubeyi seçin.");
      const response = await fetch("/api/backend/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_branch_id: selectedTransferSource.cell.branch_id,
          target_branch_id: target.branch_id,
          source_inventory_item_id:
            selectedTransferSource.cell.inventory_item_id,
          target_inventory_item_id: target.inventory_item_id,
          quantity: normalizeDecimal(transferQuantity),
          reason: transferReason.trim(),
          idempotency_key: crypto.randomUUID(),
        }),
      });
      if (!response.ok) throw new Error("Stok transferi tamamlanamadı.");
      return response.json();
    },
    onSuccess: async () => {
      toast.success("Stok transferi tamamlandı");
      setTransferDialogOpen(false);
      setTransferSource("");
      setTransferTarget("");
      setTransferQuantity("");
      setTransferReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory", "overview"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", "items"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory", "movements"] }),
      ]);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Transfer yapılamadı.",
      ),
  });

  const createItemMutation = useMutation({
    mutationFn: async (draft: InventoryItemDraft) => {
      const response = await fetch("/api/backend/inventory/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          sku: draft.sku.trim() || null,
          category: draft.category.trim() || null,
          unit: draft.unit,
          minimum_stock: normalizeDecimal(draft.minimum_stock),
          target_stock: normalizeDecimal(draft.target_stock),
          opening_quantity: normalizeDecimal(draft.opening_quantity),
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        detail?: string;
      } | null;
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
        category: "",
        unit: "piece",
        minimum_stock: "0",
        target_stock: "0",
        opening_quantity: "0",
      });
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Stok kartı oluşturulamadı.",
      ),
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
        const data = (await response.json().catch(() => null)) as {
          detail?: string;
          message?: string;
          error?: { message?: string };
        } | null;
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
      newIngredientDraft(
        items[0]?.id ?? "",
        "",
        defaultRecipeUnit(items[0]?.unit ?? "piece"),
      ),
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
              ingredient.unit,
              ingredient.name,
              ingredient.unit,
            ),
          )
        : [
            newIngredientDraft(
              items[0]?.id ?? "",
              "",
              defaultRecipeUnit(items[0]?.unit ?? "piece"),
            ),
          ],
    );
    setRecipeFormError(null);
    setRecipeDialogOpen(true);
  }

  function updateRecipeIngredient(
    key: string,
    field: "inventory_item_id" | "quantity" | "unit",
    value: string,
  ) {
    setRecipeIngredients((current) =>
      current.map((ingredient) =>
        ingredient.key === key ? { ...ingredient, [field]: value } : ingredient,
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
      newIngredientDraft(
        nextItem?.id ?? "",
        "",
        defaultRecipeUnit(nextItem?.unit ?? "piece"),
      ),
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
    if (
      !Number.isFinite(Number(normalizedYield)) ||
      Number(normalizedYield) <= 0
    ) {
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
      setRecipeFormError(
        "Aynı stok kartı reçeteye birden fazla kez eklenemez.",
      );
      return;
    }

    const normalizedItems = recipeIngredients.map((ingredient) => ({
      inventory_item_id: ingredient.inventory_item_id,
      quantity: normalizeDecimal(ingredient.quantity),
      unit: ingredient.unit,
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

  const inventoryDataLoading = itemsQuery.isLoading || movementsQuery.isLoading;
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
        <div
          className="flex min-h-72 items-center justify-center"
          role="status"
        >
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
              Malzeme ekle
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              disabled={items.length === 0 || creatableProducts.length === 0}
              onClick={openCreateRecipe}
            >
              <UtensilsCrossed />
              Reçete hazırla
            </Button>
            <Button
              className="h-10 rounded-xl"
              disabled={
                !accessibleBranches.data?.currentBranchId ||
                (accessibleBranches.data?.branches.length ?? 0) < 2
              }
              onClick={() => setRecipeCopyDialogOpen(true)}
            >
              <Copy />
              Reçete getir
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Stok kartı"
          value={overviewQuery.data?.total_items ?? items.length}
          detail="Marka envanteri"
          icon={Boxes}
          tone="brand"
        />
        <StatCard
          title="Düşük stok"
          value={overviewQuery.data?.low_count ?? lowStockItems.length}
          detail="Siparişi etkileyebilir"
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard
          title="Tükenen"
          value={overviewQuery.data?.out_of_stock_count ?? 0}
          detail="Acil tedarik gerekir"
          icon={PackageMinus}
          tone="warning"
        />
        <StatCard
          title="Bugünkü hareket"
          value={movements.length}
          detail="Satış, fire ve düzeltme"
          icon={History}
          tone="success"
        />
      </div>

      <Tabs defaultValue="balances" className="gap-4">
        <TabsList className="h-10 rounded-xl">
          <TabsTrigger value="branches" className="h-8 px-3">
            <ArrowRightLeft />
            Şubeler
          </TabsTrigger>
          <TabsTrigger value="balances" className="h-8 px-3">
            <Boxes />
            Envanter
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

        <TabsContent value="branches">
          <div className="mb-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              disabled={transferOptions.length < 2}
              onClick={() => setTransferDialogOpen(true)}
            >
              <ArrowRightLeft />
              Şubeler arası stok transferi
            </Button>
          </div>
          <DataToolbar
            value={search}
            onValueChange={setSearch}
            placeholder="Marka genelinde stok kartı, SKU veya kategori ara…"
            filters={
              <div className="flex flex-wrap gap-2">
                <Select
                  value={branchFilter}
                  onValueChange={(value) => setBranchFilter(value ?? "all")}
                >
                  <SelectTrigger className="h-10 min-w-40 rounded-xl">
                    <SelectValue placeholder="Tüm şubeler" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm şubeler</SelectItem>
                    {(overviewQuery.data?.branches ?? []).map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={categoryFilter}
                  onValueChange={(value) => setCategoryFilter(value ?? "all")}
                >
                  <SelectTrigger className="h-10 min-w-40 rounded-xl">
                    <SelectValue placeholder="Tüm kategoriler" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm kategoriler</SelectItem>
                    {overviewCategories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={stockFilter}
                  onValueChange={(value) => setStockFilter(value ?? "all")}
                >
                  <SelectTrigger className="h-10 min-w-40 rounded-xl">
                    <SelectValue placeholder="Tüm durumlar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tüm durumlar</SelectItem>
                    <SelectItem value="low">Kritik stoklar</SelectItem>
                    <SelectItem value="healthy">Normal stoklar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          />
          <div className="mt-4 overflow-x-auto rounded-2xl border bg-card">
            {overviewQuery.isLoading ? (
              <div
                className="flex min-h-52 items-center justify-center"
                role="status"
              >
                <Loader2 className="size-6 animate-spin text-brand" />
                <span className="sr-only">Şube stokları yükleniyor</span>
              </div>
            ) : overviewQuery.error ? (
              <div className="p-4">
                <EmptyState
                  title="Şube stokları yüklenemedi"
                  description="Marka stok görünümünü yeniden deneyin."
                  icon={AlertTriangle}
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="sticky left-0 z-10 min-w-52 bg-card">
                      Ürün / hammadde
                    </TableHead>
                    {visibleOverviewBranches.map((branch) => (
                      <TableHead key={branch.id} className="min-w-40">
                        {branch.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overviewQuery.data?.items ?? [])
                    .filter((item) => {
                      const term = search.trim().toLocaleLowerCase("tr-TR");
                      const matchesSearch =
                        !term ||
                        `${item.name} ${item.sku ?? ""} ${item.category ?? ""}`
                          .toLocaleLowerCase("tr-TR")
                          .includes(term);
                      const hasCritical = item.branches.some(
                        (cell) =>
                          (branchFilter === "all" ||
                            cell.branch_id === branchFilter) &&
                          cell.status !== "NORMAL",
                      );
                      return (
                        matchesSearch &&
                        (categoryFilter === "all" ||
                          item.category === categoryFilter) &&
                        (stockFilter === "all" ||
                          (stockFilter === "low" ? hasCritical : !hasCritical))
                      );
                    })
                    .map((item) => (
                      <TableRow key={item.key}>
                        <TableCell className="sticky left-0 z-10 bg-card">
                          <p className="text-sm font-semibold">{item.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.category ?? item.sku ?? "Genel"}
                          </p>
                        </TableCell>
                        {visibleOverviewBranches.map((branch) => {
                          const cell = item.branches.find(
                            (candidate) => candidate.branch_id === branch.id,
                          );
                          return (
                            <TableCell key={branch.id}>
                              {cell ? (
                                <div className="space-y-1.5">
                                  <p className="font-semibold tabular-nums">
                                    {quantityFormatter.format(
                                      Number(cell.quantity),
                                    )}{" "}
                                    {unitLabel[item.unit] ?? item.unit}
                                  </p>
                                  <StatusBadge
                                    tone={
                                      cell.status === "OUT_OF_STOCK"
                                        ? "danger"
                                        : cell.status === "LOW"
                                          ? "warning"
                                          : "success"
                                    }
                                  >
                                    {cell.status === "OUT_OF_STOCK"
                                      ? "Tükendi"
                                      : cell.status === "LOW"
                                        ? "Düşük"
                                        : "Normal"}
                                  </StatusBadge>
                                  <a
                                    className="block text-xs font-medium text-brand hover:underline"
                                    href={`/admin/inventory?branch_id=${branch.id}`}
                                  >
                                    Şubeye git
                                  </a>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">
                                  Kart yok
                                </span>
                              )}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        <TabsContent value="balances">
          <DataToolbar
            value={search}
            onValueChange={setSearch}
            placeholder="Stok kartı veya SKU ara…"
            filters={
              <Select
                value={stockFilter}
                onValueChange={(value) => setStockFilter(value ?? "all")}
              >
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
                    <TableHead className="hidden md:table-cell">
                      Minimum
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Ort. maliyet
                    </TableHead>
                    <TableHead>Durum</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const current = Number(item.current_quantity);
                    const minimum = Number(item.minimum_quantity);
                    const isOut = current <= 0;
                    const isLow = !isOut && current <= minimum;
                    const ratio =
                      minimum > 0
                        ? Math.min(100, (current / minimum) * 100)
                        : 100;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                "flex size-10 items-center justify-center rounded-xl",
                                isOut || isLow
                                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                  : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              {isOut || isLow ? (
                                <AlertTriangle className="size-4" />
                              ) : (
                                <Boxes className="size-4" />
                              )}
                            </span>
                            <div>
                              <p className="text-sm font-semibold">
                                {item.name}
                              </p>
                              <p className="text-[0.65rem] text-muted-foreground">
                                {item.sku ?? "SKU yok"}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.location_name ?? "Konum belirtilmemiş"}
                        </TableCell>
                        <TableCell>
                          <p className="text-sm font-semibold tabular-nums">
                            {quantityFormatter.format(current)}{" "}
                            {unitLabel[item.unit] ?? item.unit}
                          </p>
                          <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                isOut
                                  ? "bg-destructive"
                                  : isLow
                                    ? "bg-amber-500"
                                    : "bg-emerald-500",
                              )}
                              style={{ width: `${ratio}%` }}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="hidden text-xs md:table-cell">
                          {quantityFormatter.format(minimum)}{" "}
                          {unitLabel[item.unit] ?? item.unit}
                        </TableCell>
                        <TableCell className="hidden text-xs lg:table-cell">
                          {item.average_cost
                            ? `${currency.format(Number(item.average_cost))} / ${unitLabel[item.unit] ?? item.unit}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            tone={
                              isOut ? "danger" : isLow ? "warning" : "success"
                            }
                          >
                            {isOut ? "Tükendi" : isLow ? "Düşük" : "Normal"}
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
                  <TableHead className="hidden lg:table-cell">
                    Kullanıcı / neden
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => {
                  const meta =
                    movementMeta[movement.movement_type] ??
                    movementMeta.ADJUSTMENT;
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
                      <TableCell className="text-sm font-semibold">
                        {movement.item_name ?? movement.item_id}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          Number(movement.quantity) < 0
                            ? "text-destructive"
                            : "text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {Number(movement.quantity) > 0 ? "+" : ""}
                        {movement.quantity}
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell">
                        {movement.balance_after ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <p className="text-xs">
                          {movement.actor_name ?? "Sistem"}
                        </p>
                        <p className="text-[0.65rem] text-muted-foreground">
                          {movement.reason ?? "Sipariş yaşam döngüsü"}
                        </p>
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

          {!recipeDataLoading && !recipeDataError && products.length ? (
            <div className="mb-4 rounded-2xl border bg-card p-4">
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                Ürün reçete durumu
              </p>
              <div className="flex flex-wrap gap-2">
                {products.map((product) => {
                  const hasRecipe = recipeProductIds.has(product.id);
                  return (
                    <div
                      key={product.id}
                      className="flex items-center gap-2 rounded-lg bg-muted/45 px-3 py-2"
                    >
                      <span className="text-xs font-medium">
                        {product.name}
                      </span>
                      <StatusBadge tone={hasRecipe ? "success" : "neutral"}>
                        {hasRecipe ? "Reçete var" : "Reçete yok"}
                      </StatusBadge>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

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
                <article
                  key={recipe.id}
                  className="rounded-2xl border bg-card p-4"
                >
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
                        items.length === 0 && recipe.ingredients.length === 0
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

      <RecipeCopyDialog
        open={recipeCopyDialogOpen}
        currentBranchId={accessibleBranches.data?.currentBranchId ?? null}
        branches={accessibleBranches.data?.branches ?? []}
        products={products}
        inventoryItems={items}
        onOpenChange={setRecipeCopyDialogOpen}
        onCopied={() => {
          toast.success("Reçete bu şubeye getirildi.", {
            description:
              "Yalnız reçete tanımı kopyalandı; stok miktarları değişmedi.",
          });
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: ["inventory"] }),
            queryClient.invalidateQueries({
              queryKey: ["catalog", "products"],
            }),
          ]);
        }}
      />

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Şubeler arası stok transferi</DialogTitle>
            <DialogDescription>
              Kaynak çıkışı ve hedef girişi tek işlemde kaydedilir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Kaynak stok</Label>
              <Select
                value={transferSource}
                onValueChange={(value) => {
                  setTransferSource(value ?? "");
                  setTransferTarget("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Ürün ve şube seçin" />
                </SelectTrigger>
                <SelectContent>
                  {transferOptions.map(({ item, cell }) => (
                    <SelectItem
                      key={cell.inventory_item_id}
                      value={cell.inventory_item_id}
                    >
                      {item.name} · {cell.branch_name} ({cell.quantity}{" "}
                      {unitLabel[item.unit] ?? item.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Hedef şube</Label>
              <Select
                value={transferTarget}
                onValueChange={(value) => setTransferTarget(value ?? "")}
                disabled={!selectedTransferSource}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Hedef şubeyi seçin" />
                </SelectTrigger>
                <SelectContent>
                  {compatibleTransferTargets.map((cell) => (
                    <SelectItem
                      key={cell.inventory_item_id}
                      value={cell.inventory_item_id}
                    >
                      {cell.branch_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-quantity">Miktar</Label>
              <Input
                id="transfer-quantity"
                type="number"
                min="0.000001"
                step="0.001"
                value={transferQuantity}
                onChange={(event) => setTransferQuantity(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="transfer-reason">Neden</Label>
              <Textarea
                id="transfer-reason"
                value={transferReason}
                onChange={(event) => setTransferReason(event.target.value)}
                placeholder="Örn. Pendik şubesi kritik stok desteği"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransferDialogOpen(false)}
            >
              Vazgeç
            </Button>
            <Button
              disabled={
                !transferTarget ||
                Number(normalizeDecimal(transferQuantity)) <= 0 ||
                transferReason.trim().length < 3 ||
                transferMutation.isPending
              }
              onClick={() => transferMutation.mutate()}
            >
              {transferMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ArrowRightLeft />
              )}
              Transfer et
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Stok hareketi kaydet</DialogTitle>
            <DialogDescription>
              Hareket geri yazılmaz; düzeltme gerekiyorsa yeni bir ters kayıt
              oluşturulur.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Stok kartı</Label>
              <Select
                value={selectedItem}
                onValueChange={(value) => setSelectedItem(value ?? "")}
              >
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
                <Select
                  value={movementType}
                  onValueChange={(value) =>
                    setMovementType(value ?? "ADJUSTMENT")
                  }
                >
                  <SelectTrigger className="h-11 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PURCHASE">Satın alma</SelectItem>
                    <SelectItem value="WASTE">Fire</SelectItem>
                    <SelectItem value="ADJUSTMENT">Manuel düzeltme</SelectItem>
                    <SelectItem value="RETURN">İade</SelectItem>
                    <SelectItem value="COUNT_CORRECTION">
                      Sayım farkı
                    </SelectItem>
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
              Negatif stok politikası ve yetkili override kuralları API
              tarafından doğrulanır.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={
                !selectedItem ||
                !quantity ||
                !reason.trim() ||
                adjustmentMutation.isPending
              }
              onClick={() => adjustmentMutation.mutate()}
            >
              {adjustmentMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
              Hareketi kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={itemDialogOpen}
        onOpenChange={(open) =>
          !createItemMutation.isPending && setItemDialogOpen(open)
        }
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
                  setInventoryItemDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
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
                  setInventoryItemDraft((current) => ({
                    ...current,
                    sku: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inventory-item-category">Kategori</Label>
              <Input
                id="inventory-item-category"
                className="h-11 rounded-xl"
                placeholder="İçecek, süt ürünleri, ambalaj…"
                value={inventoryItemDraft.category}
                onChange={(event) =>
                  setInventoryItemDraft((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
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
                  <SelectTrigger className="h-11 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
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
                    setInventoryItemDraft((current) => ({
                      ...current,
                      minimum_stock: event.target.value,
                    }))
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
                    setInventoryItemDraft((current) => ({
                      ...current,
                      opening_quantity: event.target.value,
                    }))
                  }
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inventory-target-stock">Hedef stok</Label>
                <Input
                  id="inventory-target-stock"
                  inputMode="decimal"
                  className="h-11 rounded-xl"
                  value={inventoryItemDraft.target_stock}
                  onChange={(event) =>
                    setInventoryItemDraft((current) => ({
                      ...current,
                      target_stock: event.target.value,
                    }))
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
                !Number.isFinite(
                  Number(normalizeDecimal(inventoryItemDraft.minimum_stock)),
                ) ||
                !Number.isFinite(
                  Number(normalizeDecimal(inventoryItemDraft.opening_quantity)),
                ) ||
                !Number.isFinite(
                  Number(normalizeDecimal(inventoryItemDraft.target_stock)),
                ) ||
                Number(normalizeDecimal(inventoryItemDraft.minimum_stock)) <
                  0 ||
                Number(normalizeDecimal(inventoryItemDraft.opening_quantity)) <
                  0 ||
                Number(normalizeDecimal(inventoryItemDraft.target_stock)) < 0
              }
            >
              {createItemMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Check />
              )}
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
                      className="grid gap-2 rounded-xl border bg-muted/25 p-3 sm:grid-cols-[minmax(0,1fr)_120px_105px_auto] sm:items-start"
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
                          onValueChange={(value) => {
                            const inventoryItem = items.find(
                              (item) => item.id === value,
                            );
                            setRecipeIngredients((current) =>
                              current.map((currentIngredient) =>
                                currentIngredient.key === ingredient.key
                                  ? {
                                      ...currentIngredient,
                                      inventory_item_id: value ?? "",
                                      unit: defaultRecipeUnit(
                                        inventoryItem?.unit ?? "piece",
                                      ),
                                    }
                                  : currentIngredient,
                              ),
                            );
                            setRecipeFormError(null);
                          }}
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
                                {item.name} ·{" "}
                                {unitLabel[item.unit] ?? item.unit}
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
                      </div>
                      <div className="space-y-1.5">
                        <Label
                          htmlFor={`recipe-unit-${ingredient.key}`}
                          className="text-[0.68rem]"
                        >
                          Birim
                        </Label>
                        <Select
                          value={ingredient.unit}
                          onValueChange={(value) =>
                            updateRecipeIngredient(
                              ingredient.key,
                              "unit",
                              value ?? "piece",
                            )
                          }
                        >
                          <SelectTrigger
                            id={`recipe-unit-${ingredient.key}`}
                            className="h-10 w-full rounded-lg bg-card"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(
                              compatibleRecipeUnits[
                                selectedInventoryItem?.unit ??
                                  ingredient.fallback_unit ??
                                  "piece"
                              ] ?? [ingredient.unit]
                            ).map((unit) => (
                              <SelectItem key={unit} value={unit}>
                                {unitLabel[unit] ?? unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
