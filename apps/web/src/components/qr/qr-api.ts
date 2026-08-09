import { api } from "@/lib/api"

import type {
  DiningTableDto,
  PageDto,
  PublicQrRequestDto,
  PublicQrMenuDto,
  QrConfigDto,
  QrConfigInput,
  QrProductAdminDto,
  QrRequestCreate,
  QrRequestDto,
  QrRequestStatus,
} from "@/components/qr/types"

export const qrApi = {
  publicMenu(
    businessSlug: string,
    branchSlug: string,
    tableToken?: string | null,
    signal?: AbortSignal,
    lang?: string,
  ): Promise<PublicQrMenuDto> {
    return api.get<PublicQrMenuDto>(
      `qr/public/${segment(businessSlug)}/${segment(branchSlug)}`,
      {
        search: { table_token: tableToken || undefined, lang: lang || undefined },
        signal,
      },
    )
  },

  createPublicRequest(
    businessSlug: string,
    branchSlug: string,
    payload: QrRequestCreate,
    signal?: AbortSignal,
  ): Promise<PublicQrRequestDto> {
    return api.post<PublicQrRequestDto>(
      `qr/public/${segment(businessSlug)}/${segment(branchSlug)}/requests`,
      payload,
      { signal },
    )
  },

  config(signal?: AbortSignal): Promise<QrConfigDto> {
    return api.get<QrConfigDto>("qr/config", { signal })
  },

  updateConfig(payload: QrConfigInput): Promise<QrConfigDto> {
    return api.put<QrConfigDto>("qr/config", payload)
  },

  uploadAsset(
    assetKind: "logo" | "cover",
    file: File,
  ): Promise<QrConfigDto> {
    const formData = new FormData()
    formData.append("file", file)
    return api.post<QrConfigDto>(`media/qr-menu/${assetKind}`, formData, {
      timeoutMs: 60_000,
    })
  },

  deleteAsset(assetKind: "logo" | "cover"): Promise<void> {
    return api.delete<void>(`media/qr-menu/${assetKind}`)
  },

  requests(
    status?: QrRequestStatus | "ALL",
    signal?: AbortSignal,
  ): Promise<QrRequestDto[]> {
    return api.get<QrRequestDto[]>("qr/requests", {
      search: { status: status && status !== "ALL" ? status : undefined },
      signal,
    })
  },

  approve(requestId: string): Promise<QrRequestDto> {
    return api.post<QrRequestDto>(
      `qr/requests/${segment(requestId)}/approve`,
    )
  },

  reject(requestId: string): Promise<QrRequestDto> {
    return api.post<QrRequestDto>(
      `qr/requests/${segment(requestId)}/reject`,
    )
  },

  tables(signal?: AbortSignal): Promise<DiningTableDto[]> {
    return api.get<DiningTableDto[]>("tables", { signal })
  },

  regenerateTableToken(
    tableId: string,
  ): Promise<{ table_token: string }> {
    return api.post<{ table_token: string }>(
      `qr/tables/${segment(tableId)}/regenerate-token`,
    )
  },

  products(signal?: AbortSignal): Promise<PageDto<QrProductAdminDto>> {
    return api.get<PageDto<QrProductAdminDto>>("catalog/products", {
      search: { include_inactive: true, limit: 250 },
      signal,
    })
  },
}

function segment(value: string): string {
  return encodeURIComponent(value)
}
