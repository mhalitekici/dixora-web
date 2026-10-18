"use client"

import Link from "next/link"
import { UserRound } from "lucide-react"
import { useCurrentUser } from "@/hooks/use-auth"
import { ChangePasswordCard } from "@/components/admin/change-password-card"
import { ErrorState, LoadingState } from "@/components/admin/admin-utils"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"

export function ProfilePage() {
  const query = useCurrentUser()
  if (query.isLoading) return <LoadingState label="Hesabınız yükleniyor…" />
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    )
  const context = query.data
  if (!context) return null
  const home =
    context.user.roleCode === "SUPER_ADMIN"
      ? "/super-admin"
      : context.user.roleCode === "WAITER"
        ? "/waiter/tables"
        : context.user.roleCode === "CASHIER"
          ? "/cashier"
          : "/admin"
  return (
    <main
      id="dixora-main"
      className="mx-auto max-w-3xl space-y-5 px-4 py-8"
      tabIndex={-1}
    >
      <PageHeader
        title="Hesabım"
        description="Kendi bilgilerinizi görüntüleyin ve parolanızı güncelleyin."
        icon={UserRound}
        actions={
          <Button variant="outline" render={<Link href={home} />}>
            Panele dön
          </Button>
        }
      />
      <dl className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Adınız</dt>
          <dd className="mt-1 break-words font-medium">
            {context.user.displayName}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Kullanıcı adı</dt>
          <dd className="mt-1 break-all font-medium">
            {context.user.username}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">İşletme</dt>
          <dd className="mt-1 font-medium">
            {context.tenant?.name ?? "Dixora Platformu"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Aktif şube</dt>
          <dd className="mt-1 font-medium">
            {context.branch?.name ?? "Platform kapsamı"}
          </dd>
        </div>
      </dl>
      <ChangePasswordCard />
      <Button variant="ghost" render={<Link href="/support" />}>
        Yardım ve destek
      </Button>
    </main>
  )
}
