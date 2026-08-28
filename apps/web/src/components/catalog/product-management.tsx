"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChefHat,
  CircleOff,
  ImageIcon,
  Loader2,
  MoreHorizontal,
  PackageCheck,
  PackageOpen,
  Plus,
  RefreshCw,
  SearchX,
  Trash2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DataToolbar } from "@/components/shared/data-toolbar";
import { invalidateProductReadModels } from "@/components/catalog/product-cache";
import {
  ProductImageEditor,
  type ProductImageEditorSource,
} from "@/components/catalog/product-image-editor";
import { EmptyState } from "@/components/shared/empty-state";
import { ProductTransfer } from "@/components/catalog/product-transfer";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Category = {
  id: string;
  name: string;
  color?: string | null;
  is_active?: boolean;
  product_count?: number;
};

type Station = {
  id: string;
  name: string;
  is_active?: boolean;
};

type Product = {
  id: string;
  name: string;
  internal_name?: string | null;
  description?: string | null;
  category_id: string;
  category?: Category | null;
  sku?: string | null;
  selling_price: string | number;
  cost_price?: string | number | null;
  tax_rate?: string | number | null;
  preparation_station_id?: string | null;
  preparation_minutes?: number | null;
  is_active: boolean;
  is_available: boolean;
  qr_visible: boolean;
  waiter_visible: boolean;
  track_inventory: boolean;
  stock_quantity?: string | number | null;
  image_url?: string | null;
  allergens?: string[];
  calories?: number | null;
  tags?: string[];
};

type SaveProductInput = {
  values: ProductFormValues;
  productId?: string;
  imageFile: File | null;
};

const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

class ProductImageUploadError extends Error {
  readonly product: Product;

  constructor(product: Product, cause: unknown) {
    super(
      cause instanceof Error
        ? cause.message
        : "Ürün görseli yüklenemedi.",
    );
    this.name = "ProductImageUploadError";
    this.product = product;
  }
}

function validateProductImage(file: File): string | null {
  if (!PRODUCT_IMAGE_TYPES.has(file.type)) {
    return "Yalnızca JPEG, PNG veya WebP görselleri yükleyebilirsiniz.";
  }
  if (file.size === 0) {
    return "Boş bir görsel dosyası yüklenemez.";
  }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES) {
    return "Görsel boyutu en fazla 5 MB olabilir.";
  }
  return null;
}

const productSchema = z.object({
  name: z.string().trim().min(2, "Ürün adı en az 2 karakter olmalı.").max(120),
  internal_name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(800).optional(),
  category_id: z.string().min(1, "Kategori seçin."),
  selling_price: z.coerce.number().min(0, "Fiyat negatif olamaz."),
  preparation_minutes: z.coerce.number().int().min(0).max(240),
  preparation_station_id: z.string().optional(),
  is_active: z.boolean(),
  is_available: z.boolean(),
  qr_visible: z.boolean(),
  waiter_visible: z.boolean(),
  track_inventory: z.boolean(),
  allergens: z.string().trim().max(300).optional(),
  calories: z.string().trim().max(6).optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

function unwrapList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && "items" in value) {
    const items = (value as { items?: unknown }).items;
    return Array.isArray(items) ? (items as T[]) : [];
  }
  return [];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { detail?: string; message?: string; error?: { message?: string } }
    | null;
  if (!response.ok) {
    const error = payload as
      | { detail?: string; message?: string; error?: { message?: string } }
      | null;
    throw new Error(
      error?.error?.message ?? error?.detail ?? error?.message ?? "İşlem tamamlanamadı.",
    );
  }
  return payload as T;
}

const currency = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  minimumFractionDigits: 2,
});

function productColor(name: string) {
  const palette = [
    "from-orange-500/20 to-amber-500/5 text-orange-700",
    "from-blue-500/20 to-cyan-500/5 text-blue-700",
    "from-emerald-500/20 to-lime-500/5 text-emerald-700",
    "from-violet-500/20 to-fuchsia-500/5 text-violet-700",
  ];
  return palette[name.charCodeAt(0) % palette.length];
}

export function ProductManagement() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageEditorSource, setImageEditorSource] =
    useState<ProductImageEditorSource | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const editorObjectUrlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      if (editorObjectUrlRef.current) {
        URL.revokeObjectURL(editorObjectUrlRef.current);
        editorObjectUrlRef.current = null;
      }
    },
    [],
  );

  const categoriesQuery = useQuery({
    queryKey: ["catalog", "categories"],
    queryFn: async () =>
      unwrapList<Category>(await request<unknown>("/catalog/categories")),
    staleTime: 30_000,
  });

  const productsQuery = useQuery({
    queryKey: ["catalog", "products"],
    queryFn: async () =>
      unwrapList<Product>(await request<unknown>("/catalog/products")),
    staleTime: 15_000,
  });
  const stationsQuery = useQuery({
    queryKey: ["catalog", "stations"],
    queryFn: async () =>
      unwrapList<Station>(await request<unknown>("/catalog/stations")),
    staleTime: 30_000,
  });

  const categories = categoriesQuery.data ?? [];
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const stations = stationsQuery.data ?? [];

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      internal_name: "",
      description: "",
      category_id: categories[0]?.id ?? "",
      selling_price: 0,
      preparation_minutes: 10,
      preparation_station_id: stations[0]?.id ?? "",
      is_active: true,
      is_available: true,
      qr_visible: true,
      waiter_visible: true,
      track_inventory: false,
      allergens: "",
      calories: "",
    },
  });
  const formValues = useWatch({ control: form.control });

  function clearSelectedImage() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
    setImageFile(null);
    setImagePreviewUrl(null);
  }

  function closeImageEditor() {
    if (editorObjectUrlRef.current) {
      URL.revokeObjectURL(editorObjectUrlRef.current);
      editorObjectUrlRef.current = null;
    }
    if (imageInputRef.current) imageInputRef.current.value = "";
    setImageEditorSource(null);
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    const validationError = validateProductImage(file);
    if (validationError) {
      clearSelectedImage();
      setImageError(validationError);
      return;
    }

    closeImageEditor();
    const editorUrl = URL.createObjectURL(file);
    editorObjectUrlRef.current = editorUrl;
    setImageEditorSource({ file, url: editorUrl });
    setImageError(null);
  }

  function handleCroppedImage(file: File) {
    const validationError = validateProductImage(file);
    if (validationError) {
      setImageError(validationError);
      closeImageEditor();
      return;
    }

    clearSelectedImage();
    const previewUrl = URL.createObjectURL(file);
    objectUrlRef.current = previewUrl;
    setImageFile(file);
    setImagePreviewUrl(previewUrl);
    setImageError(null);
    closeImageEditor();
  }

  const saveMutation = useMutation({
    mutationFn: async ({
      values,
      productId,
      imageFile: selectedImage,
    }: SaveProductInput) => {
      const savedProduct = await request<Product>(productId ? `/catalog/products/${productId}` : "/catalog/products", {
        method: productId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...values,
          preparation_station_id: values.preparation_station_id || null,
          selling_price: values.selling_price.toFixed(2),
          allergens: (values.allergens ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          calories: values.calories?.trim() ? Number(values.calories) : null,
        }),
      });

      if (!selectedImage) return savedProduct;

      const data = new FormData();
      data.append("file", selectedImage);
      setUploadingImage(true);
      try {
        return await api.post<Product>(
          `media/products/${savedProduct.id}/image`,
          data,
        );
      } catch (error) {
        throw new ProductImageUploadError(savedProduct, error);
      } finally {
        setUploadingImage(false);
      }
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.productId
          ? variables.imageFile
            ? "Ürün ve görseli güncellendi."
            : "Ürün güncellendi."
          : variables.imageFile
            ? "Ürün oluşturuldu ve görseli yüklendi."
            : "Ürün oluşturuldu.",
      );
      clearSelectedImage();
      setImageError(null);
      setDialogOpen(false);
      setEditing(null);
      void invalidateProductReadModels(queryClient);
    },
    onError: (error) => {
      if (error instanceof ProductImageUploadError) {
        setEditing(error.product);
        toast.error("Ürün kaydedildi ancak görsel yüklenemedi.", {
          description: error.message,
        });
        void invalidateProductReadModels(queryClient);
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Ürün kaydedilemedi.",
      );
    },
  });

  const removeImageMutation = useMutation({
    mutationFn: async (product: Product) => {
      return api.delete<Product>(`media/products/${product.id}/image`);
    },
    onSuccess: (updatedProduct) => {
      clearSelectedImage();
      setImageError(null);
      setEditing((current) =>
        current
          ? {
              ...current,
              ...(updatedProduct ?? {}),
              image_url: updatedProduct?.image_url ?? null,
            }
          : current,
      );
      toast.success("Ürün görseli kaldırıldı.");
      void invalidateProductReadModels(queryClient);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Ürün görseli kaldırılamadı.",
      ),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ product, available }: { product: Product; available: boolean }) => {
      return request<Product>(`/catalog/products/${product.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_available: available }),
      });
    },
    onSuccess: () => {
      toast.success("Ürün bulunabilirliği güncellendi");
      void invalidateProductReadModels(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Ürün güncellenemedi."),
  });

  const filtered = useMemo(
    () =>
      products.filter((product) => {
        const query = search.toLocaleLowerCase("tr-TR");
        const searchMatch = product.name
          .toLocaleLowerCase("tr-TR")
          .includes(query);
        const categoryMatch = categoryFilter === "all" || product.category_id === categoryFilter;
        const availabilityMatch =
          availabilityFilter === "all" ||
          (availabilityFilter === "available" && product.is_available) ||
          (availabilityFilter === "sold-out" && !product.is_available) ||
          (availabilityFilter === "inactive" && !product.is_active);
        return searchMatch && categoryMatch && availabilityMatch;
      }),
    [availabilityFilter, categoryFilter, products, search],
  );

  function openCreate() {
    clearSelectedImage();
    setImageError(null);
    setEditing(null);
    form.reset({
      name: "",
      internal_name: "",
      description: "",
      category_id: categories[0]?.id ?? "",
      selling_price: 0,
      preparation_minutes: 10,
      preparation_station_id: stations[0]?.id ?? "",
      is_active: true,
      is_available: true,
      qr_visible: true,
      waiter_visible: true,
      track_inventory: false,
      allergens: "",
      calories: "",
    });
    setDialogOpen(true);
  }

  function openEdit(product: Product) {
    clearSelectedImage();
    setImageError(null);
    setEditing(product);
    form.reset({
      name: product.name,
      internal_name: product.internal_name ?? "",
      description: product.description ?? "",
      category_id: product.category_id,
      selling_price: Number(product.selling_price),
      preparation_minutes: product.preparation_minutes ?? 10,
      preparation_station_id: product.preparation_station_id ?? "",
      is_active: product.is_active,
      is_available: product.is_available,
      qr_visible: product.qr_visible,
      waiter_visible: product.waiter_visible,
      track_inventory: product.track_inventory,
      allergens: (product.allergens ?? []).join(", "),
      calories: product.calories != null ? String(product.calories) : "",
    });
    setDialogOpen(true);
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open && (saveMutation.isPending || removeImageMutation.isPending)) {
      return;
    }
    if (!open) {
      closeImageEditor();
      clearSelectedImage();
      setImageError(null);
      setEditing(null);
    }
    setDialogOpen(open);
  }

  const displayedImageUrl = imagePreviewUrl ?? editing?.image_url ?? null;
  const imageBusy = saveMutation.isPending || removeImageMutation.isPending;
  const catalogLoading =
    categoriesQuery.isLoading ||
    productsQuery.isLoading ||
    stationsQuery.isLoading;
  const catalogError =
    categoriesQuery.error ?? productsQuery.error ?? stationsQuery.error;
  const catalogRefreshing =
    categoriesQuery.isFetching ||
    productsQuery.isFetching ||
    stationsQuery.isFetching;
  const pageHeader = (
    <PageHeader
      eyebrow="Ortak ürün kataloğu"
      title="Ürünler"
      description="Garson, kasa, QR menü, mutfak ve stok tarafından kullanılan ürünleri tek kaynaktan yönetin."
      icon={PackageOpen}
      actions={
        <>
          <ProductTransfer />
          <Button
            className="h-10 rounded-xl"
            disabled={
              catalogLoading || Boolean(catalogError) || categories.length === 0
            }
            onClick={openCreate}
          >
            <Plus />
            Yeni ürün
          </Button>
        </>
      }
    />
  );

  if (catalogLoading) {
    return (
      <>
        {pageHeader}
        <div className="flex min-h-72 items-center justify-center" role="status">
          <Loader2 className="size-6 animate-spin text-brand" />
          <span className="sr-only">Ürün kataloğu yükleniyor</span>
        </div>
      </>
    );
  }

  if (catalogError) {
    return (
      <>
        {pageHeader}
        <EmptyState
          title="Ürün kataloğu yüklenemedi"
          description="Ürün, kategori veya hazırlık istasyonu verilerine ulaşılamıyor. Bağlantınızı kontrol edip yeniden deneyin."
          icon={AlertTriangle}
          action={
            <Button
              variant="outline"
              disabled={catalogRefreshing}
              onClick={() => {
                void Promise.all([
                  categoriesQuery.refetch(),
                  productsQuery.refetch(),
                  stationsQuery.refetch(),
                ]);
              }}
            >
              <RefreshCw
                className={catalogRefreshing ? "animate-spin" : undefined}
              />
              Yeniden dene
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {pageHeader}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Toplam ürün", products.length, PackageCheck, "text-brand bg-brand-soft"],
          ["Satışta", products.filter((item) => item.is_available && item.is_active).length, Check, "text-emerald-700 bg-emerald-500/10"],
          ["Geçici tükendi", products.filter((item) => !item.is_available && item.is_active).length, CircleOff, "text-amber-700 bg-amber-500/10"],
          ["Stok izlenen", products.filter((item) => item.track_inventory).length, PackageOpen, "text-blue-700 bg-blue-500/10"],
        ].map(([label, value, Icon, colors]) => {
          const StatIcon = Icon as typeof PackageCheck;
          return (
            <div key={String(label)} className="flex items-center gap-3 rounded-2xl border bg-card p-4">
              <span className={cn("flex size-10 items-center justify-center rounded-xl", String(colors))}>
                <StatIcon className="size-4" />
              </span>
              <div>
                <p className="text-lg font-semibold">{String(value)}</p>
                <p className="text-[0.68rem] text-muted-foreground">{String(label)}</p>
              </div>
            </div>
          );
        })}
      </div>

      <DataToolbar
        value={search}
        onValueChange={setSearch}
        placeholder="Ürün adı ara…"
        filters={
          <>
            <Select
              value={categoryFilter}
              onValueChange={(value) => setCategoryFilter(value ?? "all")}
            >
              <SelectTrigger className="h-10 min-w-40 rounded-xl">
                <SelectValue placeholder="Tüm kategoriler" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm kategoriler</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={availabilityFilter}
              onValueChange={(value) => setAvailabilityFilter(value ?? "all")}
            >
              <SelectTrigger className="h-10 min-w-36 rounded-xl">
                <SelectValue placeholder="Tüm durumlar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tüm durumlar</SelectItem>
                <SelectItem value="available">Satışta</SelectItem>
                <SelectItem value="sold-out">Geçici tükendi</SelectItem>
                <SelectItem value="inactive">Pasif</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
        actions={
          selected.size ? (
            <StatusBadge tone="brand" className="h-9 rounded-xl px-3" dot={false}>
              {selected.size} seçili
            </StatusBadge>
          ) : null
        }
      />

      <div className="mt-4 overflow-hidden rounded-2xl border bg-card">
        {productsQuery.isLoading ? (
          <div className="flex min-h-72 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-brand" />
          </div>
        ) : filtered.length ? (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-12">
                  <Checkbox
                    aria-label="Tüm ürünleri seç"
                    checked={filtered.length > 0 && filtered.every((item) => selected.has(item.id))}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? new Set(filtered.map((item) => item.id)) : new Set())
                    }
                  />
                </TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead className="hidden md:table-cell">Kategori</TableHead>
                <TableHead className="hidden lg:table-cell">Hazırlık</TableHead>
                <TableHead>Fiyat</TableHead>
                <TableHead className="hidden xl:table-cell">Görünürlük</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((product) => {
                const category = product.category ?? categories.find((item) => item.id === product.category_id);
                return (
                  <TableRow key={product.id} className="group">
                    <TableCell>
                      <Checkbox
                        aria-label={`${product.name} seç`}
                        checked={selected.has(product.id)}
                        onCheckedChange={(checked) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(product.id);
                            else next.delete(product.id);
                            return next;
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <span
                          className={cn(
                            "flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br",
                            productColor(product.name),
                          )}
                        >
                          {product.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={product.image_url}
                              alt=""
                              className="size-full rounded-xl object-cover"
                            />
                          ) : (
                            <ImageIcon className="size-4" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{product.name}</span>
                          <span className="mt-0.5 block truncate text-[0.66rem] text-muted-foreground">
                            {[
                              product.track_inventory && product.stock_quantity !== undefined
                                ? `Stok ${product.stock_quantity}`
                                : null,
                              product.calories != null ? `${product.calories} kcal` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || product.category?.name || "—"}
                          </span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="inline-flex items-center gap-2 text-xs">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: category?.color ?? "var(--muted-foreground)" }}
                        />
                        {category?.name ?? "Kategorisiz"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex items-center gap-2 text-xs">
                        <ChefHat className="size-3.5 text-muted-foreground" />
                        <span>
                          {stations.find(
                            (station) => station.id === product.preparation_station_id,
                          )?.name ?? "Atanmamış"}
                          <span className="block text-[0.62rem] text-muted-foreground">
                            ~{product.preparation_minutes ?? 0} dk
                          </span>
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-semibold tabular-nums">
                        {currency.format(Number(product.selling_price))}
                      </p>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-1 text-[0.58rem] font-semibold",
                            product.waiter_visible ? "bg-blue-500/10 text-blue-700" : "bg-muted text-muted-foreground",
                          )}
                        >
                          Garson
                        </span>
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-1 text-[0.58rem] font-semibold",
                            product.qr_visible ? "bg-violet-500/10 text-violet-700" : "bg-muted text-muted-foreground",
                          )}
                        >
                          QR
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() =>
                          toggleMutation.mutate({ product, available: !product.is_available })
                        }
                      >
                        <StatusBadge
                          tone={!product.is_active ? "danger" : product.is_available ? "success" : "warning"}
                        >
                          {!product.is_active ? "Pasif" : product.is_available ? "Satışta" : "Tükendi"}
                        </StatusBadge>
                      </button>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={<Button variant="ghost" size="icon-sm" aria-label="Ürün işlemleri" />}
                        >
                          <MoreHorizontal />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(product)}>
                            <PackageOpen />
                            Ürünü düzenle
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              toggleMutation.mutate({ product, available: !product.is_available })
                            }
                          >
                            <CircleOff />
                            {product.is_available ? "Geçici tükendi yap" : "Satışa aç"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive">
                            <CircleOff />
                            Arşivle
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="p-4">
            <EmptyState
              title="Ürün bulunamadı"
              description="Arama ve filtreleri temizleyin veya kataloğa yeni bir ürün ekleyin."
              icon={SearchX}
              action={
                <Button onClick={openCreate}>
                  <Plus />
                  Yeni ürün
                </Button>
              }
            />
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `${editing.name} ürününü düzenle` : "Yeni ürün oluştur"}</DialogTitle>
            <DialogDescription>
              Bu kayıt garson, kasa, QR menü, hazırlık bileti ve raporlarda ortak kullanılır.
            </DialogDescription>
          </DialogHeader>
          <form
            id="product-form"
            className="space-y-5"
            onSubmit={form.handleSubmit((values) =>
              saveMutation.mutate({
                values,
                productId: editing?.id,
                imageFile,
              }),
            )}
          >
            <div className="grid gap-4 rounded-2xl border bg-muted/20 p-3 sm:grid-cols-[160px_1fr]">
              <div className="relative aspect-square overflow-hidden rounded-xl border bg-card">
                {displayedImageUrl ? (
                  // Blob previews cannot be processed by the Next.js image optimizer.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={displayedImageUrl}
                    alt={`${formValues.name?.trim() || editing?.name || "Ürün"} görsel önizlemesi`}
                    className="size-full object-cover"
                  />
                ) : (
                  <div className="flex size-full flex-col items-center justify-center text-muted-foreground">
                    <ImageIcon className="size-6" />
                    <span className="mt-2 text-[0.65rem] font-semibold">
                      Görsel yok
                    </span>
                  </div>
                )}
                {uploadingImage ? (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 text-xs font-semibold"
                    role="status"
                  >
                    <Loader2 className="mb-2 size-5 animate-spin text-brand" />
                    Yükleniyor
                  </div>
                ) : null}
              </div>
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="product-image">Ürün görseli</Label>
                  <Input
                    ref={imageInputRef}
                    id="product-image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    className="h-11 cursor-pointer rounded-xl py-2 file:mr-3"
                    aria-invalid={Boolean(imageError)}
                    aria-describedby={
                      imageError
                        ? "product-image-help product-image-error"
                        : "product-image-help"
                    }
                    disabled={imageBusy}
                    onChange={handleImageChange}
                  />
                  <p
                    id="product-image-help"
                    className="text-xs text-muted-foreground"
                  >
                    JPEG, PNG veya WebP · En fazla 5 MB. Seçimden sonra kırpma
                    ve boyutlandırma ekranı açılır.
                  </p>
                  {imageError ? (
                    <p
                      id="product-image-error"
                      className="text-xs text-destructive"
                      role="alert"
                    >
                      {imageError}
                    </p>
                  ) : null}
                </div>
                {imageFile ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {imageFile.name}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={imageBusy}
                      onClick={() => imageInputRef.current?.click()}
                    >
                      Görseli değiştir
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={imageBusy}
                      onClick={() => {
                        clearSelectedImage();
                        setImageError(null);
                      }}
                    >
                      <X />
                      Seçimi kaldır
                    </Button>
                  </div>
                ) : editing?.image_url ? (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={imageBusy}
                    onClick={() => removeImageMutation.mutate(editing)}
                  >
                    {removeImageMutation.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                    Kayıtlı görseli sil
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Görsel, ürün kaydedildikten sonra güvenli medya alanına
                    yüklenecek.
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="product-name">Ürün adı</Label>
                <Input
                  id="product-name"
                  className="h-11 rounded-xl"
                  placeholder="Örn. Klasik Burger"
                  autoFocus
                  aria-invalid={Boolean(form.formState.errors.name)}
                  {...form.register("name")}
                />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Ürün kategorisi</Label>
                  <Select
                    value={formValues.category_id}
                    onValueChange={(value) =>
                      form.setValue("category_id", value ?? "", {
                        shouldValidate: true,
                      })
                    }
                  >
                    <SelectTrigger className="h-11 w-full rounded-xl">
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
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="product-description">Açıklama</Label>
              <Textarea
                id="product-description"
                rows={3}
                className="rounded-xl"
                placeholder="Müşterinin ve servis ekibinin göreceği kısa açıklama…"
                {...form.register("description")}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="selling-price">Satış fiyatı</Label>
                <Input
                  id="selling-price"
                  type="number"
                  step="0.01"
                  min="0"
                  className="h-11 rounded-xl"
                  {...form.register("selling_price")}
                />
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="station">İstasyon</Label>
                <Select
                  value={formValues.preparation_station_id || "unassigned"}
                  onValueChange={(value) =>
                    form.setValue(
                      "preparation_station_id",
                      value === "unassigned" || value === null ? "" : value,
                    )
                  }
                >
                  <SelectTrigger id="station" className="h-11 w-full rounded-xl">
                    <SelectValue placeholder="İstasyon seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Atanmamış</SelectItem>
                    {stations.map((station) => (
                      <SelectItem key={station.id} value={station.id}>
                        {station.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="prep-time">Hazırlık (dk)</Label>
                <Input
                  id="prep-time"
                  type="number"
                  min="0"
                  max="240"
                  className="h-11 rounded-xl"
                  {...form.register("preparation_minutes")}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="product-allergens">Alerjenler</Label>
                <Input
                  id="product-allergens"
                  className="h-11 rounded-xl"
                  placeholder="Örn. Gluten, Süt, Fındık"
                  {...form.register("allergens")}
                />
                <p className="text-xs text-muted-foreground">
                  Virgülle ayırarak girin. QR menüde alerjen bilgisi açıksa müşteriye gösterilir.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-1">
                <Label htmlFor="product-calories">Kalori (kcal)</Label>
                <Input
                  id="product-calories"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="20000"
                  className="h-11 rounded-xl"
                  placeholder="Örn. 650"
                  {...form.register("calories")}
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["is_active", "Aktif ürün", "Katalog ve yönetim ekranında kullanılsın."],
                ["is_available", "Satışa açık", "Garson ve kasada siparişe eklenebilsin."],
                ["waiter_visible", "Garson menüsü", "Garson ürün seçiminde gösterilsin."],
                ["qr_visible", "QR menü", "Public menüde müşteriye gösterilsin."],
                ["track_inventory", "Stok takibi", "Reçete üzerinden stok düşümü yapılsın."],
              ].map(([field, title, description]) => (
                <label key={field} className="flex items-center justify-between rounded-xl border p-3">
                  <span className="pr-3">
                    <span className="block text-xs font-semibold">{title}</span>
                    <span className="mt-0.5 block text-[0.64rem] leading-4 text-muted-foreground">
                      {description}
                    </span>
                  </span>
                  <Switch
                    checked={Boolean(formValues[field as keyof ProductFormValues])}
                    onCheckedChange={(checked) =>
                      form.setValue(field as keyof ProductFormValues, checked as never)
                    }
                  />
                </label>
              ))}
            </div>
          </form>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
              disabled={saveMutation.isPending || removeImageMutation.isPending}
            >
              Vazgeç
            </Button>
            <Button
              form="product-form"
              type="submit"
              disabled={
                saveMutation.isPending ||
                removeImageMutation.isPending
              }
            >
              {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              {uploadingImage
                ? "Görsel yükleniyor"
                : editing
                  ? "Değişiklikleri kaydet"
                  : "Ürünü oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ProductImageEditor
        key={imageEditorSource?.url ?? "closed-product-image-editor"}
        open={Boolean(imageEditorSource)}
        source={imageEditorSource}
        onCancel={closeImageEditor}
        onComplete={handleCroppedImage}
      />
    </>
  );
}
