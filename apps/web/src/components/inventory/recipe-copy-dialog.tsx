"use client";

import { Copy, Loader2, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Branch = { id: string; name: string };
type Product = { id: string; name: string; is_active?: boolean };
type InventoryItem = { id: string; name: string; unit: string };
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

type Props = {
  open: boolean;
  currentBranchId: string | null;
  branches: Branch[];
  products: Product[];
  inventoryItems: InventoryItem[];
  onOpenChange: (open: boolean) => void;
  onCopied: () => void;
};

const CREATE_NEW = "__create_new__";
const dimensions: Record<string, string> = {
  piece: "count",
  gram: "mass",
  kilogram: "mass",
  milliliter: "volume",
  liter: "volume",
};
const unitLabels: Record<string, string> = {
  piece: "adet",
  gram: "g",
  kilogram: "kg",
  milliliter: "ml",
  liter: "L",
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await response.json().catch(() => null)) as
    T | { detail?: string; error?: { message?: string } } | null;
  if (!response.ok) {
    const error = data as {
      detail?: string;
      error?: { message?: string };
    } | null;
    throw new Error(
      error?.error?.message ?? error?.detail ?? "İşlem tamamlanamadı.",
    );
  }
  return data as T;
}

export function RecipeCopyDialog({
  open,
  currentBranchId,
  branches,
  products,
  inventoryItems,
  onOpenChange,
  onCopied,
}: Props) {
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState("");
  const [targetProductId, setTargetProductId] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [loadingRecipes, setLoadingRecipes] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recipeLoadRequest = useRef(0);

  const sourceBranches = branches.filter(
    (branch) => branch.id !== currentBranchId,
  );
  const recipe = recipes.find((candidate) => candidate.id === recipeId);

  function resetDialog() {
    recipeLoadRequest.current += 1;
    setSourceBranchId("");
    setRecipes([]);
    setRecipeId("");
    setTargetProductId("");
    setMappings({});
    setError(null);
    setLoadingRecipes(false);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) resetDialog();
    onOpenChange(next);
  }

  function selectRecipe(nextRecipeId: string, availableRecipes = recipes) {
    setRecipeId(nextRecipeId);
    const nextRecipe = availableRecipes.find(
      (candidate) => candidate.id === nextRecipeId,
    );
    if (!nextRecipe) {
      setTargetProductId("");
      setMappings({});
      return;
    }
    const sameProduct = products.find(
      (product) =>
        product.is_active !== false &&
        product.name.localeCompare(nextRecipe.product_name, "tr", {
          sensitivity: "base",
        }) === 0,
    );
    setTargetProductId(sameProduct?.id ?? "");
    setMappings(
      Object.fromEntries(
        nextRecipe.ingredients.map((ingredient) => {
          const match = inventoryItems.find(
            (item) =>
              dimensions[item.unit] === dimensions[ingredient.unit] &&
              item.name.localeCompare(ingredient.name, "tr", {
                sensitivity: "base",
              }) === 0,
          );
          return [ingredient.inventory_item_id, match?.id ?? CREATE_NEW];
        }),
      ),
    );
  }

  async function selectSourceBranch(nextBranchId: string) {
    const requestId = recipeLoadRequest.current + 1;
    recipeLoadRequest.current = requestId;
    setSourceBranchId(nextBranchId);
    setRecipes([]);
    selectRecipe("", []);
    setError(null);
    if (!nextBranchId) {
      setLoadingRecipes(false);
      return;
    }
    setLoadingRecipes(true);
    try {
      const values = await requestJson<Recipe[]>(
        `/inventory/recipes?branch_id=${nextBranchId}`,
      );
      if (recipeLoadRequest.current !== requestId) return;
      setRecipes(values);
      selectRecipe(values[0]?.id ?? "", values);
    } catch (loadError) {
      if (recipeLoadRequest.current !== requestId) return;
      setError(
        loadError instanceof Error ? loadError.message : "Reçeteler alınamadı.",
      );
    } finally {
      if (recipeLoadRequest.current === requestId) setLoadingRecipes(false);
    }
  }

  const mappingReady = useMemo(
    () =>
      Boolean(recipe) &&
      recipe!.ingredients.every((ingredient) =>
        Boolean(mappings[ingredient.inventory_item_id]),
      ),
    [mappings, recipe],
  );

  async function copyRecipe() {
    if (!recipe || !currentBranchId || !targetProductId || !mappingReady)
      return;
    setPending(true);
    setError(null);
    try {
      const resolvedMappings: Array<{
        source_inventory_item_id: string;
        target_inventory_item_id: string;
      }> = [];
      for (const ingredient of recipe.ingredients) {
        let targetId = mappings[ingredient.inventory_item_id];
        if (targetId === CREATE_NEW) {
          const created = await requestJson<{ id: string }>(
            "/inventory/items",
            {
              method: "POST",
              body: JSON.stringify({
                name: ingredient.name,
                unit: ingredient.unit,
                minimum_stock: "0",
                target_stock: "0",
                opening_quantity: "0",
              }),
            },
          );
          targetId = created.id;
        }
        resolvedMappings.push({
          source_inventory_item_id: ingredient.inventory_item_id,
          target_inventory_item_id: targetId,
        });
      }
      await requestJson("/inventory/recipes/copy", {
        method: "POST",
        body: JSON.stringify({
          source_branch_id: sourceBranchId,
          target_branch_id: currentBranchId,
          source_product_id: recipe.product_id,
          target_product_id: targetProductId,
          ingredient_mappings: resolvedMappings,
        }),
      });
      onCopied();
      resetDialog();
      onOpenChange(false);
    } catch (copyError) {
      setError(
        copyError instanceof Error ? copyError.message : "Reçete getirilemedi.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reçete getir</DialogTitle>
          <DialogDescription>
            Başka bir şubedeki reçete tanımını bu şubeye kopyalayın. Stok
            miktarları kopyalanmaz.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Kaynak şube</Label>
            <Select
              value={sourceBranchId}
              onValueChange={(value) => void selectSourceBranch(value ?? "")}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue placeholder="Şube seçin" />
              </SelectTrigger>
              <SelectContent>
                {sourceBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Kaynak reçete</Label>
            <Select
              value={recipeId}
              disabled={!sourceBranchId || loadingRecipes}
              onValueChange={(value) => selectRecipe(value ?? "")}
            >
              <SelectTrigger className="h-11 w-full">
                <SelectValue
                  placeholder={
                    loadingRecipes ? "Yükleniyor..." : "Reçete seçin"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {recipes.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.product_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {recipe ? (
          <div className="space-y-4 rounded-xl border bg-muted/25 p-4">
            <div className="space-y-1.5">
              <Label>Bu şubedeki ürün</Label>
              <Select
                value={targetProductId}
                onValueChange={(value) => setTargetProductId(value ?? "")}
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Hedef ürünü seçin" />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter((product) => product.is_active !== false)
                    .map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div>
                <p className="text-sm font-semibold">Malzeme eşleştirme</p>
                <p className="text-xs text-muted-foreground">
                  Her kaynak malzemeyi doğrulayın; eşleşme yoksa yeni kart
                  oluşturun.
                </p>
              </div>
              {recipe.ingredients.map((ingredient) => {
                const compatible = inventoryItems.filter(
                  (item) =>
                    dimensions[item.unit] === dimensions[ingredient.unit],
                );
                return (
                  <div
                    key={ingredient.inventory_item_id}
                    className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
                  >
                    <div>
                      <p className="text-sm font-medium">{ingredient.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ingredient.quantity}{" "}
                        {unitLabels[ingredient.unit] ?? ingredient.unit}
                      </p>
                    </div>
                    <Select
                      value={mappings[ingredient.inventory_item_id] ?? ""}
                      onValueChange={(value) =>
                        setMappings((current) => ({
                          ...current,
                          [ingredient.inventory_item_id]: value ?? "",
                        }))
                      }
                    >
                      <SelectTrigger className="h-10 w-full">
                        <SelectValue placeholder="Malzeme seçin" />
                      </SelectTrigger>
                      <SelectContent>
                        {compatible.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} · {unitLabels[item.unit] ?? item.unit}
                          </SelectItem>
                        ))}
                        <SelectItem value={CREATE_NEW}>
                          <Plus /> Yeni malzeme oluştur
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {sourceBranchId && !loadingRecipes && recipes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Bu şubede kopyalanabilecek reçete yok.
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => handleOpenChange(false)}
          >
            Vazgeç
          </Button>
          <Button
            type="button"
            disabled={pending || !targetProductId || !mappingReady}
            onClick={() => void copyRecipe()}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Copy />}
            {pending ? "Getiriliyor..." : "Reçeteyi getir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
