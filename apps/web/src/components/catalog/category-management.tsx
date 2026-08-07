"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Layers3,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Tags,
} from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { readableForeground } from "@/components/qr/qr-utils";

type Category = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  parent_id?: string | null;
  sort_order: number;
  is_active: boolean;
  product_count?: number;
};

const categorySchema = z.object({
  name: z.string().trim().min(1, "Kategori adı zorunludur.").max(120),
  description: z.string().trim().max(500, "Açıklama en fazla 500 karakter olabilir."),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Geçerli bir HEX renk girin."),
  is_active: z.boolean(),
});

type CategoryFormValues = z.infer<typeof categorySchema>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => null)) as T | { detail?: string } | null;
  if (!response.ok) throw new Error((payload as { detail?: string } | null)?.detail ?? "İşlem başarısız.");
  return payload as T;
}

function unwrap<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

export function CategoryManagement() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: "",
      description: "",
      color: "#EC5A20",
      is_active: true,
    },
  });
  const watchedColor = useWatch({ control: form.control, name: "color" });
  const previewColor = /^#[0-9A-Fa-f]{6}$/.test(watchedColor)
    ? watchedColor
    : "#EC5A20";

  const query = useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: async () =>
      unwrap<Category>(await api<unknown>("/catalog/categories")),
  });

  const categories = query.data ?? [];
  const mutation = useMutation({
    mutationFn: (values: CategoryFormValues) => {
      return api<Category>(editing ? `/catalog/categories/${editing.id}` : "/catalog/categories", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          name: values.name,
          description: values.description || null,
          color: values.color.toUpperCase(),
          is_active: values.is_active,
          sort_order: editing?.sort_order ?? categories.length + 1,
        }),
      });
    },
    onSuccess: () => {
      toast.success(editing ? "Kategori güncellendi" : "Kategori oluşturuldu");
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["catalog", "categories"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Kategori kaydedilemedi."),
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: -1 | 1 }) => {
      const category = categories[index];
      const adjacent = categories[index + direction];
      if (!category || !adjacent) return;
      await api<Category>(`/catalog/categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ sort_order: adjacent.sort_order }),
      });
      try {
        await api<Category>(`/catalog/categories/${adjacent.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sort_order: category.sort_order }),
        });
      } catch (error) {
        await api<Category>(`/catalog/categories/${category.id}`, {
          method: "PATCH",
          body: JSON.stringify({ sort_order: category.sort_order }),
        }).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["catalog", "categories"] }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Kategori sırası güncellenemedi."),
  });

  function open(category?: Category) {
    setEditing(category ?? null);
    form.reset({
      name: category?.name ?? "",
      description: category?.description ?? "",
      color: category?.color ?? "#EC5A20",
      is_active: category?.is_active ?? true,
    });
    setDialogOpen(true);
  }

  return (
    <>
      <PageHeader
        eyebrow="Menü mimarisi"
        title="Kategoriler"
        description="Ürünlerin garson, kasa ve QR menüdeki sırasını ve görünürlüğünü ortak bir yapıdan yönetin."
        icon={Tags}
        actions={
          <Button
            className="h-10 rounded-xl"
            onClick={() => open()}
            disabled={query.isLoading || query.isError}
          >
            <Plus />
            Yeni kategori
          </Button>
        }
      />
      {query.isLoading ? (
        <div className="flex min-h-72 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-brand" />
        </div>
      ) : query.isError ? (
        <EmptyState
          title="Kategoriler yüklenemedi"
          description="Katalog verilerine şu anda ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin."
          icon={AlertTriangle}
          action={
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={query.isFetching ? "animate-spin" : undefined} />
              Yeniden dene
            </Button>
          }
        />
      ) : categories.length ? (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {categories.map((category, index) => (
          <article key={category.id} className="group rounded-2xl border bg-card p-4 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/5">
            <div className="flex items-start gap-3">
              <span
                className="flex size-11 shrink-0 items-center justify-center rounded-2xl shadow-sm"
                style={{
                  backgroundColor: category.color ?? "#777777",
                  color: readableForeground(category.color ?? "#777777"),
                }}
              >
                <Layers3 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">{category.name}</h2>
                    <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                      {category.product_count ?? 0} ürün · Sıra {category.sort_order}
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Kategori işlemleri" />}>
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => open(category)}>
                        <Pencil />
                        Düzenle
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={index === 0 || reorderMutation.isPending}
                        onClick={() => reorderMutation.mutate({ index, direction: -1 })}
                      >
                        <ArrowUp />
                        Yukarı taşı
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={
                          index === categories.length - 1 ||
                          reorderMutation.isPending
                        }
                        onClick={() => reorderMutation.mutate({ index, direction: 1 })}
                      >
                        <ArrowDown />
                        Aşağı taşı
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">
                  {category.description || "Kategori açıklaması eklenmemiş."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <StatusBadge tone={category.is_active ? "success" : "neutral"}>
                {category.is_active ? "Yayında" : "Pasif"}
              </StatusBadge>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={index === 0 || reorderMutation.isPending}
                  aria-label="Yukarı taşı"
                  onClick={() => reorderMutation.mutate({ index, direction: -1 })}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={
                    index === categories.length - 1 ||
                    reorderMutation.isPending
                  }
                  aria-label="Aşağı taşı"
                  onClick={() => reorderMutation.mutate({ index, direction: 1 })}
                >
                  <ArrowDown />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
      ) : (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <Tags className="mx-auto size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">Henüz kategori yok</p>
          <p className="mt-1 text-xs text-muted-foreground">
            İlk menü kategorinizi oluşturarak ürünleri düzenlemeye başlayın.
          </p>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Kategoriyi düzenle" : "Yeni kategori"}</DialogTitle>
            <DialogDescription>
              Aynı kategori sırası tüm satış kanallarında kullanılacaktır.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category-name">Kategori adı</Label>
              <Input
                id="category-name"
                className="h-11 rounded-xl"
                aria-invalid={Boolean(form.formState.errors.name)}
                {...form.register("name")}
                autoFocus
              />
              {form.formState.errors.name ? (
                <p role="alert" className="text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="category-description">Kısa açıklama</Label>
              <Input
                id="category-description"
                className="h-11 rounded-xl"
                aria-invalid={Boolean(form.formState.errors.description)}
                {...form.register("description")}
              />
              {form.formState.errors.description ? (
                <p role="alert" className="text-xs text-destructive">
                  {form.formState.errors.description.message}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <div className="space-y-2">
                <Label htmlFor="category-color">Tema rengi</Label>
                <div className="flex gap-2">
                  <Input
                    id="category-color-picker"
                    type="color"
                    className="h-11 w-14 rounded-xl p-1"
                    aria-label="Kategori rengi seç"
                    value={previewColor}
                    onChange={(event) =>
                      form.setValue("color", event.target.value.toUpperCase(), {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                  />
                  <Input
                    id="category-color"
                    className="h-11 rounded-xl font-mono uppercase"
                    aria-invalid={Boolean(form.formState.errors.color)}
                    maxLength={7}
                    {...form.register("color")}
                  />
                </div>
                {form.formState.errors.color ? (
                  <p role="alert" className="text-xs text-destructive">
                    {form.formState.errors.color.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label>Önizleme</Label>
                <span
                  className="flex size-11 items-center justify-center rounded-xl border"
                  style={{
                    backgroundColor: previewColor,
                    color: readableForeground(previewColor),
                  }}
                >
                  <Tags className="size-4" />
                </span>
              </div>
            </div>
            <label className="flex items-center justify-between rounded-xl border p-3">
              <span>
                <span className="block text-sm font-semibold">Aktif kategori</span>
                <span className="block text-xs text-muted-foreground">Menü yüzeylerinde görünür.</span>
              </span>
              <Controller
                name="is_active"
                control={form.control}
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label="Aktif kategori"
                  />
                )}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Vazgeç
            </Button>
            <Button
              disabled={mutation.isPending}
              onClick={() =>
                void form.handleSubmit((values) => mutation.mutate(values))()
              }
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
