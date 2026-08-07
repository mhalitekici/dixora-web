import { Skeleton } from "@/components/ui/skeleton"

export default function PublicMenuLoading() {
  return (
    <div className="min-h-dvh bg-background">
      <Skeleton className="h-56 w-full rounded-none" />
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-8">
        <Skeleton className="h-12 w-full rounded-2xl" />
        <div className="flex gap-2 overflow-hidden">
          {[1, 2, 3, 4].map((item) => (
            <Skeleton key={item} className="h-10 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((item) => (
            <Skeleton key={item} className="h-32 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
