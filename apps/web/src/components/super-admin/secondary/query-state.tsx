import { AlertCircle, Inbox, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

export function SecondaryPageSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="İçerik yükleniyor">
      <div className="flex items-start gap-3">
        <Skeleton className="size-11 rounded-2xl" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-64 max-w-[70vw]" />
          <Skeleton className="h-4 w-96 max-w-[82vw]" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  )
}

export function QueryErrorState({
  title = "Veriler alınamadı",
  description,
  retry,
}: {
  title?: string
  description: string
  retry: () => void
}) {
  return (
    <Card>
      <CardContent className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
        <span className="flex size-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertCircle className="size-5" />
        </span>
        <h2 className="mt-4 text-base font-semibold">{title}</h2>
        <p className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        <Button className="mt-4" variant="outline" onClick={retry}>
          <RefreshCw />
          Yeniden dene
        </Button>
      </CardContent>
    </Card>
  )
}

export function EmptyDataState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Inbox className="size-5" />
      </span>
      <p className="mt-4 text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
