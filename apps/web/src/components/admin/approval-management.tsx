"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgePercent,
  Check,
  ClipboardCheck,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { adminApi, adminKeys } from "./admin-api";
import {
  approvalStatusText,
  approvalTypeText,
  dateTime,
  ErrorState,
  LoadingState,
  money,
  shortId,
  toneForApproval,
} from "./admin-utils";
import type { ApprovalRequest, ApprovalStatus, ApprovalType } from "./types";

type StatusFilter = ApprovalStatus | "ALL";
type TypeFilter = ApprovalType | "ALL";

const RESOLVABLE_TYPES = new Set<ApprovalType>(["DISCOUNT", "ITEM_CANCELLATION", "ORDER_VOID"]);

export function ApprovalManagement() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [approvalType, setApprovalType] = useState<TypeFilter>("ALL");

  const approvalsQuery = useQuery({
    queryKey: adminKeys.approvalRequests(status, approvalType),
    queryFn: ({ signal }) =>
      adminApi.approvalRequests({ status, approvalType }, signal),
    refetchInterval: status === "PENDING" || status === "ALL" ? 10_000 : false,
    staleTime: 5_000,
  });

  async function invalidateAfterResolution() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...adminKeys.root, "approval-requests"] }),
      queryClient.invalidateQueries({ queryKey: adminKeys.orders("ALL", 0, 25) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.dashboard() }),
    ]);
  }

  const approveMutation = useMutation({
    mutationFn: (request: ApprovalRequest) =>
      request.approval_type === "DISCOUNT"
        ? adminApi.approveDiscountRequest(request.id)
        : adminApi.approveCancellationRequest(request.id),
    onSuccess: async () => {
      toast.success("Talep onaylandı");
      await invalidateAfterResolution();
    },
    onError: (error) => {
      toast.error("Talep onaylanamadı", {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (request: ApprovalRequest) =>
      request.approval_type === "DISCOUNT"
        ? adminApi.rejectDiscountRequest(request.id)
        : adminApi.rejectCancellationRequest(request.id),
    onSuccess: async () => {
      toast.success("Talep reddedildi");
      await invalidateAfterResolution();
    },
    onError: (error) => {
      toast.error("Talep reddedilemedi", {
        description: error instanceof Error ? error.message : "Lütfen tekrar deneyin.",
      });
    },
  });

  const approvals = approvalsQuery.data ?? [];
  const pendingDiscounts = approvals.filter(
    (row) => row.approval_type === "DISCOUNT" && row.status === "PENDING",
  ).length;
  const pendingCancellations = approvals.filter(
    (row) =>
      (row.approval_type === "ITEM_CANCELLATION" || row.approval_type === "ORDER_VOID") &&
      row.status === "PENDING",
  ).length;

  return (
    <div>
      <PageHeader
        eyebrow="Yönetim"
        title="Onaylar"
        description="Kasa ve garson tarafından oluşturulan ürün iptal ve indirim taleplerini burada onaylayın veya reddedin."
        icon={ClipboardCheck}
        actions={
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            onClick={() => void approvalsQuery.refetch()}
            disabled={approvalsQuery.isFetching}
          >
            <RefreshCw className={approvalsQuery.isFetching ? "animate-spin" : ""} />
            Yenile
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <StatCard
          title="Bekleyen ürün iptal talepleri"
          value={pendingCancellations}
          icon={Trash2}
          tone={pendingCancellations > 0 ? "warning" : "default"}
        />
        <StatCard
          title="Bekleyen indirim talepleri"
          value={pendingDiscounts}
          icon={BadgePercent}
          tone={pendingDiscounts > 0 ? "warning" : "default"}
        />
      </div>

      <div className="mb-5 flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Talep filtresi</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bekleyen talepler 10 saniyede bir otomatik yenilenir.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={approvalType}
            onValueChange={(value) => setApprovalType((value ?? "ALL") as TypeFilter)}
          >
            <SelectTrigger className="h-10 w-full rounded-xl sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tüm talep türleri</SelectItem>
              <SelectItem value="DISCOUNT">İndirim talepleri</SelectItem>
              <SelectItem value="ITEM_CANCELLATION">Ürün iptal talepleri</SelectItem>
              <SelectItem value="ORDER_VOID">Sipariş iptal talepleri</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(value) => setStatus((value ?? "PENDING") as StatusFilter)}
          >
            <SelectTrigger className="h-10 w-full rounded-xl sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PENDING">Onay bekleyenler</SelectItem>
              <SelectItem value="APPROVED">Onaylananlar</SelectItem>
              <SelectItem value="REJECTED">Reddedilenler</SelectItem>
              <SelectItem value="ALL">Tümü</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {approvalsQuery.isLoading ? (
        <LoadingState label="Onay talepleri yükleniyor…" />
      ) : approvalsQuery.isError ? (
        <ErrorState
          error={approvalsQuery.error}
          onRetry={() => void approvalsQuery.refetch()}
          title="Onay talepleri alınamadı"
        />
      ) : approvals.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Bu filtrede talep yok"
          description="Kasa veya garson yeni bir iptal ya da indirim talebi oluşturduğunda burada görünecek."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {approvals.map((request) => (
            <ApprovalCard
              key={request.id}
              request={request}
              approvePending={approveMutation.isPending && approveMutation.variables?.id === request.id}
              rejectPending={rejectMutation.isPending && rejectMutation.variables?.id === request.id}
              onApprove={() => approveMutation.mutate(request)}
              onReject={() => rejectMutation.mutate(request)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  request,
  approvePending,
  rejectPending,
  onApprove,
  onReject,
}: {
  request: ApprovalRequest;
  approvePending: boolean;
  rejectPending: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const pending = request.status === "PENDING" && RESOLVABLE_TYPES.has(request.approval_type);
  const discountValue =
    request.approval_type === "DISCOUNT"
      ? String(request.payload.kind) === "PERCENTAGE"
        ? `%${request.payload.value}`
        : money(String(request.payload.value ?? "0"))
      : null;

  return (
    <article className="rounded-xl border bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.03)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{request.table_name ?? "Masa bilinmiyor"}</h2>
            <StatusBadge tone={toneForApproval(request.status)} pulse={request.status === "PENDING"}>
              {approvalStatusText[request.status]}
            </StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {approvalTypeText[request.approval_type]}
            {discountValue ? ` · ${discountValue}` : ""}
          </p>
        </div>
        <span className="shrink-0 text-xs font-mono text-muted-foreground">
          {shortId(request.id)}
        </span>
      </div>

      <div className="mt-3 space-y-1.5 rounded-xl bg-muted/55 p-3 text-sm">
        {request.order_item_name ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Ürün</span>
            <span className="font-medium">{request.order_item_name}</span>
          </div>
        ) : null}
        {request.order_total ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Sipariş tutarı</span>
            <span className="font-medium">{money(request.order_total)}</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Talebi oluşturan</span>
          <span className="font-medium">{request.requested_by_name ?? "—"}</span>
        </div>
        {request.resolved_by_name ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              {request.status === "APPROVED" ? "Onaylayan" : "Reddeden"}
            </span>
            <span className="font-medium">{request.resolved_by_name}</span>
          </div>
        ) : null}
      </div>

      <p className="mt-3 rounded-lg border border-amber-500/15 bg-amber-500/5 p-2.5 text-xs italic text-amber-900 dark:text-amber-200">
        “{request.reason}”
      </p>

      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
        <span className="text-xs text-muted-foreground">{dateTime(request.created_at)}</span>
        {pending ? (
          <div className="flex gap-1.5">
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={approvePending || rejectPending}
                  />
                }
              >
                {rejectPending ? <Loader2 className="animate-spin" /> : <X />}
                Reddet
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia className="bg-destructive/10 text-destructive">
                    <X />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Talep reddedilsin mi?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {approvalTypeText[request.approval_type]} reddedilir ve sipariş üzerinde hiçbir
                    değişiklik yapılmaz.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Vazgeç</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onReject}>
                    Talebi reddet
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <AlertDialog>
              <AlertDialogTrigger
                render={<Button type="button" size="sm" disabled={approvePending || rejectPending} />}
              >
                {approvePending ? <Loader2 className="animate-spin" /> : <Check />}
                Onayla
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogMedia className="bg-emerald-500/10 text-emerald-700">
                    <Check />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Talep onaylansın mı?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {approvalTypeText[request.approval_type]} onaylanır ve sipariş toplamı buna göre
                    güncellenir.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Tekrar incele</AlertDialogCancel>
                  <AlertDialogAction onClick={onApprove}>Onayla</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : null}
      </div>
    </article>
  );
}
