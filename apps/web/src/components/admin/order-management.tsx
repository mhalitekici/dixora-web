"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Eye,
  Filter,
  ListFilter,
  PackageOpen,
  ReceiptText,
  Search,
  ShoppingBag,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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

import { adminApi, adminKeys } from "./admin-api";
import {
  AdapterNotice,
  dateTime,
  ErrorState,
  LoadingState,
  money,
  number,
  orderStatusText,
  shortId,
  toneForOrder,
} from "./admin-utils";
import type { Order, OrderSource, OrderStatus } from "./types";

const PAGE_SIZE = 25;
const statusOptions: Array<{ value: OrderStatus; label: string }> = Object.entries(
  orderStatusText,
).map(([value, label]) => ({ value: value as OrderStatus, label }));
const sourceLabels: Record<OrderSource, string> = {
  WAITER: "Garson",
  CASHIER: "Kasa",
  QR: "QR menü",
  TAKEAWAY: "Paket",
  DELIVERY: "Teslimat",
  KIOSK: "Kiosk",
  API: "API",
};

export function OrderManagement({ initialOrderId }: { initialOrderId?: string }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState<OrderStatus | "ALL">("ALL");
  const [source, setSource] = useState<OrderSource | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    initialOrderId ?? null,
  );

  const ordersQuery = useQuery({
    queryKey: adminKeys.orders(status, page * PAGE_SIZE, PAGE_SIZE),
    queryFn: ({ signal }) =>
      adminApi.orders(
        {
          status: status === "ALL" ? undefined : status,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
        signal,
      ),
  });
  const selectedQuery = useQuery({
    queryKey: adminKeys.order(selectedOrderId ?? ""),
    queryFn: ({ signal }) => adminApi.order(selectedOrderId ?? "", signal),
    enabled: Boolean(selectedOrderId),
  });
  const acceptMutation = useMutation({
    mutationFn: adminApi.acceptOrder,
    onSuccess: async (order) => {
      queryClient.setQueryData(adminKeys.order(order.id), order);
      await queryClient.invalidateQueries({ queryKey: [...adminKeys.root, "orders"] });
      toast.success("Sipariş kabul edildi.");
    },
    onError: () => toast.error("Sipariş kabul edilemedi."),
  });

  const filteredOrders = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase("tr-TR");
    return (ordersQuery.data?.items ?? []).filter((order) => {
      if (source !== "ALL" && order.source !== source) return false;
      if (!normalized) return true;
      return (
        order.id.toLocaleLowerCase("tr-TR").includes(normalized) ||
        order.customer_name?.toLocaleLowerCase("tr-TR").includes(normalized) ||
        order.items.some((item) =>
          item.product_name_snapshot.toLocaleLowerCase("tr-TR").includes(normalized),
        )
      );
    });
  }, [ordersQuery.data?.items, search, source]);

  const totals = useMemo(() => {
    const items = ordersQuery.data?.items ?? [];
    return {
      value: items.reduce((sum, order) => sum + Number(order.total), 0),
      itemCount: items.reduce((sum, order) => sum + order.items.length, 0),
      paid: items.filter((order) => order.status === "PAID").length,
    };
  }, [ordersQuery.data?.items]);

  if (ordersQuery.isLoading) return <LoadingState label="Siparişler yükleniyor…" />;
  if (ordersQuery.error) {
    return <ErrorState error={ordersQuery.error} onRetry={() => void ordersQuery.refetch()} />;
  }

  const total = ordersQuery.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader
        eyebrow="Gerçek sipariş kayıtları"
        title="Siparişler"
        description="Duruma göre filtreleyin, kalemleri ve ödemeleri inceleyin, bekleyen siparişleri yönetin."
        icon={ReceiptText}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Toplam kayıt"
          value={number(total)}
          detail="Seçili durum filtresinde"
          icon={ReceiptText}
          tone="info"
        />
        <StatCard
          title="Bu sayfanın tutarı"
          value={money(totals.value)}
          detail={`${filteredOrders.length} görünür sipariş`}
          icon={CircleDollarSign}
          tone="brand"
        />
        <StatCard
          title="Ürün kalemi"
          value={number(totals.itemCount)}
          detail="Bu API sayfasında"
          icon={ShoppingBag}
          tone="warning"
        />
        <StatCard
          title="Ödenen"
          value={number(totals.paid)}
          detail="Bu API sayfasında"
          icon={PackageOpen}
          tone="success"
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-2xl border bg-card p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Sipariş ara"
            name="order-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Sipariş no, müşteri veya ürün ara…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value as OrderStatus | "ALL");
              setPage(0);
            }}
          >
            <SelectTrigger className="h-10 min-w-44 rounded-xl">
              <Filter />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tüm durumlar</SelectItem>
              {statusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={source} onValueChange={(value) => setSource(value as OrderSource | "ALL")}>
            <SelectTrigger className="h-10 min-w-36 rounded-xl">
              <ListFilter />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tüm kanallar</SelectItem>
              {Object.entries(sourceLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <AdapterNotice className="mb-4" title="Filtre kapsamı">
        Durum ve sayfalama backend’de uygulanır. Mevcut sipariş API’si kaynak ve metin araması
        parametrelerini desteklemediği için kanal ve arama filtreleri yalnız yüklenen API sayfasında
        çalışır (adapter TODO).
      </AdapterNotice>

      <Card>
        <CardContent className="p-0">
          {filteredOrders.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Sipariş</TableHead>
                  <TableHead>Kaynak</TableHead>
                  <TableHead>Durum</TableHead>
                  <TableHead>Kalem</TableHead>
                  <TableHead>Tarih</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                  <TableHead className="w-14 pr-4">
                    <span className="sr-only">İncele</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="pl-4">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        <span className="block font-semibold">#{shortId(order.id)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {order.customer_name || "Misafir"}
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>{sourceLabels[order.source]}</TableCell>
                    <TableCell>
                      <StatusBadge tone={toneForOrder(order.status)}>
                        {orderStatusText[order.status]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>{order.items.length}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {dateTime(order.created_at)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {money(order.total, order.currency)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`#${shortId(order.id)} siparişini incele`}
                        onClick={() => setSelectedOrderId(order.id)}
                      >
                        <Eye />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-5">
              <EmptyState
                compact
                title="Sipariş bulunamadı"
                description="Filtreleri veya arama ifadesini değiştirin."
                icon={ReceiptText}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {total ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)}` : "0"} /{" "}
          {number(total)} kayıt
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft />
            Önceki
          </Button>
          <span className="min-w-20 text-center">
            {page + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            Sonraki
            <ChevronRight />
          </Button>
        </div>
      </div>

      <Dialog
        open={Boolean(selectedOrderId)}
        onOpenChange={(open) => {
          if (!open) setSelectedOrderId(null);
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Sipariş {selectedOrderId ? `#${shortId(selectedOrderId)}` : ""}
            </DialogTitle>
            <DialogDescription>
              Ürün kalemleri, modifiyerler, ödeme ve sipariş zaman çizgisi.
            </DialogDescription>
          </DialogHeader>
          {selectedQuery.isLoading ? (
            <LoadingState label="Sipariş detayı yükleniyor…" />
          ) : selectedQuery.error ? (
            <ErrorState
              error={selectedQuery.error}
              onRetry={() => void selectedQuery.refetch()}
              title="Sipariş detayı alınamadı"
            />
          ) : selectedQuery.data ? (
            <OrderDetail order={selectedQuery.data} />
          ) : null}
          <DialogFooter>
            {selectedQuery.data?.status === "SUBMITTED" ? (
              <Button
                onClick={() => {
                  const order = selectedQuery.data;
                  if (order) acceptMutation.mutate(order.id);
                }}
                disabled={acceptMutation.isPending}
              >
                Siparişi kabul et
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setSelectedOrderId(null)}>
              Kapat
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrderDetail({ order }: { order: Order }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <DetailMetric label="Durum">
          <StatusBadge tone={toneForOrder(order.status)}>{orderStatusText[order.status]}</StatusBadge>
        </DetailMetric>
        <DetailMetric label="Kaynak" value={sourceLabels[order.source]} />
        <DetailMetric label="Oluşturulma" value={dateTime(order.created_at)} />
      </div>

      <div className="rounded-xl border">
        <div className="border-b px-4 py-3">
          <p className="font-semibold">Sipariş kalemleri</p>
        </div>
        <div className="divide-y">
          {order.items.map((item) => (
            <div key={item.id} className="flex gap-3 p-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-bold">
                {number(item.quantity, 2)}×
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.product_name_snapshot}</p>
                {item.modifiers.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.modifiers
                      .map((modifier) => `${modifier.quantity}× ${modifier.name_snapshot}`)
                      .join(" · ")}
                  </p>
                ) : null}
                {item.note ? (
                  <p className="mt-2 rounded-lg bg-amber-500/8 px-2.5 py-2 text-xs">
                    Not: {item.note}
                  </p>
                ) : null}
              </div>
              <p className="font-semibold tabular-nums">
                {money(item.line_total, order.currency)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_0.8fr]">
        <div className="rounded-xl border p-4">
          <p className="mb-3 flex items-center gap-2 font-semibold">
            <Users className="size-4" />
            Müşteri ve ödeme
          </p>
          <p className="text-sm">{order.customer_name || "Misafir"}</p>
          {order.payments.length ? (
            <div className="mt-3 space-y-2">
              {order.payments.map((payment) => (
                <div key={payment.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{payment.method}</span>
                  <span className="font-medium">{money(payment.amount, order.currency)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Henüz ödeme kaydı yok.</p>
          )}
        </div>
        <div className="rounded-xl border bg-muted/25 p-4">
          <p className="mb-3 font-semibold">Tutar özeti</p>
          <MoneyRow label="Ara toplam" value={money(order.subtotal, order.currency)} />
          <MoneyRow label="İndirim" value={`−${money(order.discount_total, order.currency)}`} />
          <MoneyRow label="Vergi" value={money(order.tax_total, order.currency)} />
          <div className="mt-3 flex justify-between border-t pt-3 text-base font-bold">
            <span>Toplam</span>
            <span>{money(order.total, order.currency)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailMetric({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 font-medium">{children ?? value}</div>
    </div>
  );
}

function MoneyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2 flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
