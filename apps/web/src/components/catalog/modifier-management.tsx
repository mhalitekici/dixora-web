"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Check,
  CircleAlert,
  Layers2,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Modifier = {
  id: string;
  group_id: string;
  name: string;
  price_delta: string | number;
  is_active: boolean;
  sort_order: number;
};

type ModifierGroup = {
  id: string;
  name: string;
  is_required: boolean;
  minimum_selection: number;
  maximum_selection: number | null;
  sort_order: number;
  is_active: boolean;
  modifiers: Modifier[];
  product_ids: string[];
};

type ProductSummary = {
  id: string;
  name: string;
  is_active: boolean;
};

type ProductPage = {
  items: ProductSummary[];
  total: number;
  limit: number;
  offset: number;
};

type ArchiveTarget =
  | { kind: "group"; group: ModifierGroup }
  | { kind: "modifier"; group: ModifierGroup; modifier: Modifier };

const modifierKeys = {
  groups: ["catalog", "modifier-groups"] as const,
  products: ["catalog", "products", "modifier-assignment"] as const,
};

const groupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Grup adı zorunludur.")
      .max(120, "Grup adı en fazla 120 karakter olabilir."),
    is_required: z.boolean(),
    minimum_selection: z.coerce
      .number()
      .int("Minimum seçim tam sayı olmalıdır.")
      .min(0, "Minimum seçim negatif olamaz."),
    maximum_selection: z.coerce
      .number()
      .int("Maksimum seçim tam sayı olmalıdır.")
      .min(1, "Maksimum seçim en az 1 olmalıdır."),
    sort_order: z.coerce
      .number()
      .int("Sıra tam sayı olmalıdır.")
      .min(0, "Sıra negatif olamaz."),
    unlimited: z.boolean(),
    product_ids: z.array(z.string().min(1)),
  })
  .superRefine((values, context) => {
    if (values.is_required && values.minimum_selection < 1) {
      context.addIssue({
        code: "custom",
        message: "Zorunlu gruplarda minimum seçim en az 1 olmalıdır.",
        path: ["minimum_selection"],
      });
    }
    if (!values.unlimited && values.maximum_selection < values.minimum_selection) {
      context.addIssue({
        code: "custom",
        message: "Maksimum seçim minimum seçimden küçük olamaz.",
        path: ["maximum_selection"],
      });
    }
  });

const modifierSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Seçenek adı zorunludur.")
    .max(120, "Seçenek adı en fazla 120 karakter olabilir."),
  price_delta: z
    .string()
    .trim()
    .min(1, "Fiyat farkı zorunludur.")
    .regex(
      /^-?\d{1,11}([.,]\d{1,2})?$/,
      "En fazla iki ondalık basamak içeren geçerli bir tutar girin.",
    ),
  sort_order: z.coerce
    .number()
    .int("Sıra tam sayı olmalıdır.")
    .min(0, "Sıra negatif olamaz."),
});

type GroupFormValues = z.infer<typeof groupSchema>;
type ModifierFormValues = z.infer<typeof modifierSchema>;

const money = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
});

function modifierPrice(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return "Dahil";
  return amount > 0 ? `+${money.format(amount)}` : money.format(amount);
}

function activeModifiers(group: ModifierGroup) {
  return group.modifiers
    .filter((modifier) => modifier.is_active !== false)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
}

export function ModifierManagement() {
  const queryClient = useQueryClient();
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null>(null);
  const [modifierDialogOpen, setModifierDialogOpen] = useState(false);
  const [modifierGroup, setModifierGroup] = useState<ModifierGroup | null>(null);
  const [editingModifier, setEditingModifier] = useState<Modifier | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ArchiveTarget | null>(null);

  const groupsQuery = useQuery({
    queryKey: modifierKeys.groups,
    queryFn: ({ signal }) =>
      api.get<ModifierGroup[]>("catalog/modifier-groups", { signal }),
  });
  const productsQuery = useQuery({
    queryKey: modifierKeys.products,
    queryFn: ({ signal }) =>
      api.get<ProductPage>("catalog/products", {
        search: { limit: 250, offset: 0 },
        signal,
      }),
  });

  const invalidateGroups = () =>
    queryClient.invalidateQueries({ queryKey: modifierKeys.groups });
  const invalidateAssignments = () =>
    queryClient.invalidateQueries({ queryKey: ["catalog", "products"] });

  const groupMutation = useMutation({
    mutationFn: ({
      groupId,
      values,
    }: {
      groupId?: string;
      values: GroupFormValues;
    }) => {
      const payload = {
        name: values.name,
        is_required: values.is_required,
        minimum_selection: values.minimum_selection,
        maximum_selection: values.unlimited ? null : values.maximum_selection,
        product_ids: values.product_ids,
      };
      return groupId
        ? api.patch<ModifierGroup>(`catalog/modifier-groups/${groupId}`, {
            ...payload,
            sort_order: values.sort_order,
          })
        : api.post<ModifierGroup>("catalog/modifier-groups", payload);
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.groupId
          ? "Modifiyer grubu güncellendi."
          : "Modifiyer grubu oluşturuldu.",
      );
      setGroupDialogOpen(false);
      setEditingGroup(null);
      await Promise.all([invalidateGroups(), invalidateAssignments()]);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Modifiyer grubu kaydedilemedi.",
      ),
  });

  const modifierMutation = useMutation({
    mutationFn: ({
      groupId,
      modifierId,
      values,
    }: {
      groupId: string;
      modifierId?: string;
      values: ModifierFormValues;
    }) => {
      const commonPayload = {
        name: values.name,
        price_delta: values.price_delta.replace(",", "."),
        sort_order: values.sort_order,
      };
      return modifierId
        ? api.patch<Modifier>(`catalog/modifiers/${modifierId}`, commonPayload)
        : api.post<Modifier>("catalog/modifiers", {
            group_id: groupId,
            ...commonPayload,
          });
    },
    onSuccess: async (_, variables) => {
      toast.success(
        variables.modifierId
          ? "Modifiyer seçeneği güncellendi."
          : "Modifiyer seçeneği eklendi.",
      );
      setModifierDialogOpen(false);
      setModifierGroup(null);
      setEditingModifier(null);
      await invalidateGroups();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Modifiyer seçeneği kaydedilemedi.",
      ),
  });

  const archiveMutation = useMutation({
    mutationFn: (target: ArchiveTarget) =>
      target.kind === "group"
        ? api.delete<void>(`catalog/modifier-groups/${target.group.id}`)
        : api.delete<void>(`catalog/modifiers/${target.modifier.id}`),
    onSuccess: async (_, target) => {
      toast.success(
        target.kind === "group"
          ? "Modifiyer grubu arşivlendi."
          : "Modifiyer seçeneği arşivlendi.",
      );
      setArchiveTarget(null);
      await Promise.all([
        invalidateGroups(),
        ...(target.kind === "group" ? [invalidateAssignments()] : []),
      ]);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Kayıt arşivlenemedi.",
      ),
  });

  function openGroup(group?: ModifierGroup) {
    setEditingGroup(group ?? null);
    setGroupDialogOpen(true);
  }

  function openModifier(group: ModifierGroup, modifier?: Modifier) {
    setModifierGroup(group);
    setEditingModifier(modifier ?? null);
    setModifierDialogOpen(true);
  }

  const firstError = groupsQuery.error ?? productsQuery.error;
  const loading = groupsQuery.isLoading || productsQuery.isLoading;
  const groups = groupsQuery.data ?? [];
  const products = productsQuery.data?.items ?? [];
  const busy =
    groupMutation.isPending ||
    modifierMutation.isPending ||
    archiveMutation.isPending;

  return (
    <>
      <PageHeader
        eyebrow="Ürün seçenekleri"
        title="Modifiyerler"
        description="Boyut, pişirme derecesi ve ücretli ekstraları seçim kurallarıyla tanımlayın."
        icon={SlidersHorizontal}
        actions={
          <Button
            className="h-10 rounded-xl"
            onClick={() => openGroup()}
            disabled={loading || Boolean(firstError) || busy}
          >
            <Plus />
            Yeni grup
          </Button>
        }
      />

      {loading ? (
        <div
          className="flex min-h-72 items-center justify-center"
          role="status"
          aria-label="Modifiyer grupları yükleniyor"
        >
          <Loader2 className="size-6 animate-spin text-brand" />
        </div>
      ) : firstError ? (
        <QueryErrorState
          error={firstError}
          fetching={groupsQuery.isFetching || productsQuery.isFetching}
          onRetry={() => {
            void groupsQuery.refetch();
            void productsQuery.refetch();
          }}
        />
      ) : groups.length ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <ModifierGroupCard
              key={group.id}
              group={group}
              disabled={busy}
              onEditGroup={() => openGroup(group)}
              onArchiveGroup={() => setArchiveTarget({ kind: "group", group })}
              onAddModifier={() => openModifier(group)}
              onEditModifier={(modifier) => openModifier(group, modifier)}
              onArchiveModifier={(modifier) =>
                setArchiveTarget({ kind: "modifier", group, modifier })
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Henüz modifiyer grubu yok"
          description="Boyut, sos veya pişirme derecesi gibi ilk seçenek grubunuzu oluşturun."
          icon={Layers2}
          action={
            <Button onClick={() => openGroup()} disabled={busy}>
              <Plus />
              İlk grubu oluştur
            </Button>
          }
        />
      )}

      {groupDialogOpen ? (
        <GroupEditorDialog
          open
          group={editingGroup}
          products={products}
          productTotal={productsQuery.data?.total ?? products.length}
          pending={groupMutation.isPending}
          onOpenChange={(open) => {
            if (!groupMutation.isPending) setGroupDialogOpen(open);
          }}
          onSubmit={(values) =>
            groupMutation.mutate({
              groupId: editingGroup?.id,
              values,
            })
          }
        />
      ) : null}

      {modifierDialogOpen && modifierGroup ? (
        <ModifierEditorDialog
          open
          group={modifierGroup}
          modifier={editingModifier}
          pending={modifierMutation.isPending}
          onOpenChange={(open) => {
            if (!modifierMutation.isPending) setModifierDialogOpen(open);
          }}
          onSubmit={(values) =>
            modifierMutation.mutate({
              groupId: modifierGroup.id,
              modifierId: editingModifier?.id,
              values,
            })
          }
        />
      ) : null}

      <ArchiveConfirmation
        target={archiveTarget}
        pending={archiveMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !archiveMutation.isPending) setArchiveTarget(null);
        }}
        onConfirm={() => {
          if (archiveTarget) archiveMutation.mutate(archiveTarget);
        }}
      />
    </>
  );
}

function ModifierGroupCard({
  group,
  disabled,
  onEditGroup,
  onArchiveGroup,
  onAddModifier,
  onEditModifier,
  onArchiveModifier,
}: {
  group: ModifierGroup;
  disabled: boolean;
  onEditGroup: () => void;
  onArchiveGroup: () => void;
  onAddModifier: () => void;
  onEditModifier: (modifier: Modifier) => void;
  onArchiveModifier: (modifier: Modifier) => void;
}) {
  const modifiers = activeModifiers(group);

  return (
    <article className="overflow-hidden rounded-2xl border bg-card">
      <header className="flex items-start gap-3 border-b p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Layers2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{group.name}</h2>
            <StatusBadge
              tone={group.is_required ? "brand" : "neutral"}
              dot={false}
            >
              {group.is_required ? "Zorunlu" : "Opsiyonel"}
            </StatusBadge>
          </div>
          <p className="mt-1 text-[0.68rem] text-muted-foreground">
            {group.minimum_selection}–{group.maximum_selection ?? "∞"} seçim ·{" "}
            {group.product_ids.length} üründe · {modifiers.length} seçenek · Sıra{" "}
            {group.sort_order}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${group.name} grup işlemleri`}
                disabled={disabled}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEditGroup}>
              <Pencil />
              Grubu düzenle
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onArchiveGroup}>
              <Archive />
              Grubu arşivle
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="p-2">
        {modifiers.length ? (
          <div className="space-y-1">
            {modifiers.map((modifier) => (
              <div
                key={modifier.id}
                className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {modifier.name}
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold",
                    Number(modifier.price_delta) > 0
                      ? "text-brand"
                      : "text-muted-foreground",
                  )}
                >
                  {modifierPrice(modifier.price_delta)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${modifier.name} seçenek işlemleri`}
                        disabled={disabled}
                      />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEditModifier(modifier)}>
                      <Pencil />
                      Düzenle
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => onArchiveModifier(modifier)}
                    >
                      <Archive />
                      Arşivle
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-muted/35 px-3 py-4 text-center text-xs text-muted-foreground">
            Bu grupta henüz aktif seçenek yok.
          </p>
        )}
        <Button
          variant="ghost"
          className="mt-1 h-9 w-full justify-start rounded-xl text-brand"
          disabled={disabled}
          onClick={onAddModifier}
        >
          <Plus />
          Seçenek ekle
        </Button>
      </div>
    </article>
  );
}

function GroupEditorDialog({
  open,
  group,
  products,
  productTotal,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  group: ModifierGroup | null;
  products: ProductSummary[];
  productTotal: number;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: GroupFormValues) => void;
}) {
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupSchema),
    defaultValues: {
      name: group?.name ?? "",
      is_required: group?.is_required ?? false,
      minimum_selection: group?.minimum_selection ?? 0,
      maximum_selection:
        group?.maximum_selection ?? Math.max(group?.minimum_selection ?? 0, 1),
      sort_order: group?.sort_order ?? 0,
      unlimited: group?.maximum_selection === null,
      product_ids: group?.product_ids ?? [],
    },
  });
  const required = useWatch({ control: form.control, name: "is_required" });
  const unlimited = useWatch({ control: form.control, name: "unlimited" });
  const selectedProductIds =
    useWatch({ control: form.control, name: "product_ids" }) ?? [];
  const errors = form.formState.errors;

  function toggleProduct(productId: string, checked: boolean) {
    const next = checked
      ? Array.from(new Set([...selectedProductIds, productId]))
      : selectedProductIds.filter((id) => id !== productId);
    form.setValue("product_ids", next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {group ? "Modifiyer grubunu düzenle" : "Yeni modifiyer grubu"}
          </DialogTitle>
          <DialogDescription>
            Seçim sınırları ve ürün bağlantıları garson, kasa ve QR siparişinde
            ortak kullanılır.
          </DialogDescription>
        </DialogHeader>

        <form
          id="modifier-group-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="modifier-group-name">Grup adı</Label>
            <Input
              id="modifier-group-name"
              className="h-11 rounded-xl"
              placeholder="Örn. Sos seçimi"
              autoFocus
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "modifier-group-name-error" : undefined}
              {...form.register("name")}
            />
            <FieldError id="modifier-group-name-error" message={errors.name?.message} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <div>
              <Label htmlFor="modifier-group-required" className="font-semibold">
                Zorunlu seçim
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ürün, minimum seçim yapılmadan siparişe eklenemez.
              </p>
            </div>
            <Switch
              id="modifier-group-required"
              checked={required}
              onCheckedChange={(checked) => {
                form.setValue("is_required", checked, {
                  shouldDirty: true,
                  shouldValidate: true,
                });
                if (checked && form.getValues("minimum_selection") < 1) {
                  form.setValue("minimum_selection", 1, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="modifier-group-minimum">Minimum seçim</Label>
              <Input
                id="modifier-group-minimum"
                type="number"
                min={0}
                step={1}
                className="h-11 rounded-xl"
                aria-invalid={Boolean(errors.minimum_selection)}
                aria-describedby={
                  errors.minimum_selection
                    ? "modifier-group-minimum-error"
                    : undefined
                }
                {...form.register("minimum_selection", { valueAsNumber: true })}
              />
              <FieldError
                id="modifier-group-minimum-error"
                message={errors.minimum_selection?.message}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modifier-group-maximum">Maksimum seçim</Label>
              <Input
                id="modifier-group-maximum"
                type="number"
                min={1}
                step={1}
                className="h-11 rounded-xl"
                disabled={unlimited}
                aria-invalid={Boolean(errors.maximum_selection)}
                aria-describedby={
                  errors.maximum_selection
                    ? "modifier-group-maximum-error"
                    : undefined
                }
                {...form.register("maximum_selection", { valueAsNumber: true })}
              />
              <FieldError
                id="modifier-group-maximum-error"
                message={errors.maximum_selection?.message}
              />
            </div>
          </div>

          {group ? (
            <div className="space-y-2">
              <Label htmlFor="modifier-group-order">Görüntüleme sırası</Label>
              <Input
                id="modifier-group-order"
                type="number"
                min={0}
                step={1}
                className="h-11 rounded-xl"
                aria-invalid={Boolean(errors.sort_order)}
                aria-describedby={
                  errors.sort_order ? "modifier-group-order-error" : undefined
                }
                {...form.register("sort_order", { valueAsNumber: true })}
              />
              <FieldError
                id="modifier-group-order-error"
                message={errors.sort_order?.message}
              />
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
            <div>
              <Label htmlFor="modifier-group-unlimited" className="font-semibold">
                Sınırsız seçim
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Maksimum seçim sınırını kaldırır.
              </p>
            </div>
            <Switch
              id="modifier-group-unlimited"
              checked={unlimited}
              onCheckedChange={(checked) =>
                form.setValue("unlimited", checked, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            />
          </div>

          <fieldset className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <legend className="text-sm font-medium">Bağlı ürünler</legend>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Bu grubun gösterileceği ürünleri seçin.
                </p>
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {selectedProductIds.length} seçili
              </span>
            </div>
            {products.length ? (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border p-2">
                {products.map((product) => {
                  const checked = selectedProductIds.includes(product.id);
                  return (
                    <label
                      key={product.id}
                      className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/55"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          toggleProduct(product.id, nextChecked)
                        }
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {product.name}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">
                Bağlanabilecek aktif ürün bulunamadı.
              </p>
            )}
            {productTotal > products.length ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                İlk {products.length} ürün gösteriliyor. Görünmeyen mevcut ürün
                bağlantıları korunacaktır.
              </p>
            ) : null}
          </fieldset>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="modifier-group-form"
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            {group ? "Değişiklikleri kaydet" : "Grubu oluştur"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModifierEditorDialog({
  open,
  group,
  modifier,
  pending,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  group: ModifierGroup;
  modifier: Modifier | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ModifierFormValues) => void;
}) {
  const form = useForm<ModifierFormValues>({
    resolver: zodResolver(modifierSchema),
    defaultValues: {
      name: modifier?.name ?? "",
      price_delta:
        modifier === null ? "0.00" : String(modifier.price_delta).replace(",", "."),
      sort_order: modifier?.sort_order ?? activeModifiers(group).length,
    },
  });
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {modifier ? "Seçeneği düzenle" : "Yeni modifiyer seçeneği"}
          </DialogTitle>
          <DialogDescription>
            “{group.name}” grubundaki seçenek adı, fiyat farkı ve görüntülenme
            sırasını yönetin.
          </DialogDescription>
        </DialogHeader>

        <form
          id="modifier-option-form"
          className="space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="modifier-option-name">Seçenek adı</Label>
            <Input
              id="modifier-option-name"
              className="h-11 rounded-xl"
              placeholder="Örn. Ekstra cheddar"
              autoFocus
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "modifier-option-name-error" : undefined}
              {...form.register("name")}
            />
            <FieldError id="modifier-option-name-error" message={errors.name?.message} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="modifier-option-price">Fiyat farkı</Label>
              <div className="relative">
                <Input
                  id="modifier-option-price"
                  inputMode="decimal"
                  className="h-11 rounded-xl pr-10"
                  placeholder="0.00"
                  aria-invalid={Boolean(errors.price_delta)}
                  aria-describedby={
                    errors.price_delta ? "modifier-option-price-error" : undefined
                  }
                  {...form.register("price_delta")}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                  TRY
                </span>
              </div>
              <FieldError
                id="modifier-option-price-error"
                message={errors.price_delta?.message}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modifier-option-order">Görüntüleme sırası</Label>
              <Input
                id="modifier-option-order"
                type="number"
                min={0}
                step={1}
                className="h-11 rounded-xl"
                aria-invalid={Boolean(errors.sort_order)}
                aria-describedby={
                  errors.sort_order ? "modifier-option-order-error" : undefined
                }
                {...form.register("sort_order", { valueAsNumber: true })}
              />
              <FieldError
                id="modifier-option-order-error"
                message={errors.sort_order?.message}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            İndirim niteliğindeki seçenekler için negatif bir fiyat farkı
            girebilirsiniz.
          </p>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="modifier-option-form"
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            {modifier ? "Değişiklikleri kaydet" : "Seçeneği ekle"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveConfirmation({
  target,
  pending,
  onOpenChange,
  onConfirm,
}: {
  target: ArchiveTarget | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const groupName = target?.group.name ?? "";
  const targetName =
    target?.kind === "modifier" ? target.modifier.name : groupName;

  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {target?.kind === "group"
              ? "Modifiyer grubunu arşivle?"
              : "Modifiyer seçeneğini arşivle?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target?.kind === "group"
              ? `“${targetName}” grubu bağlı ürünlerin yeni sipariş seçeneklerinden kaldırılacak. Geçmiş sipariş kayıtları korunur.`
              : `“${targetName}” seçeneği “${groupName}” grubundaki yeni siparişlerden kaldırılacak. Geçmiş sipariş kayıtları korunur.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Archive />}
            Arşivle
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function QueryErrorState({
  error,
  fetching,
  onRetry,
}: {
  error: unknown;
  fetching: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex min-h-72 flex-col items-center justify-center rounded-2xl border border-dashed px-6 text-center"
      role="alert"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <CircleAlert className="size-5" />
      </span>
      <h2 className="mt-4 font-semibold">Modifiyerler yüklenemedi</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        {error instanceof Error
          ? error.message
          : "Katalog servisine ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin."}
      </p>
      <Button
        variant="outline"
        className="mt-5"
        onClick={onRetry}
        disabled={fetching}
      >
        <RefreshCw className={cn(fetching && "animate-spin")} />
        Yeniden dene
      </Button>
    </div>
  );
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive" role="alert">
      {message}
    </p>
  );
}
