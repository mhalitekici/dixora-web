"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Check,
  Building2,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Loader2,
  LifeBuoy,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { adminApi, adminKeys } from "@/components/admin/admin-api";
import { BrandLogo } from "@/components/brand/brand-logo";
import { type NavGroup } from "@/components/layout/nav-config";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useAccessibleBranches,
  useCurrentUser,
  useLogout,
  useSwitchBranch,
} from "@/hooks/use-auth";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: ReactNode;
  navigation: NavGroup[];
  workspaceName?: string;
  branchName?: string;
  userName?: string;
  userRole?: string;
  platformMode?: boolean;
};

function isActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

function permissionForNavigation(href: string): string | null {
  const mappings: Array<[string, string]> = [
    ["/super-admin/system", "platform.system.read"],
    ["/super-admin/audit-logs", "platform.system.read"],
    ["/super-admin", "platform.businesses.manage"],
    ["/admin/branch-settings", "settings.manage"],
    ["/admin/settings", "settings.manage"],
    ["/admin/audit-logs", "audit.read"],
    ["/admin/approvals", "orders.manage"],
    ["/admin/employees", "users.manage"],
    ["/admin/roles", "roles.manage"],
    ["/admin/reports", "reports.read"],
    ["/admin/inventory", "inventory.read"],
    ["/admin/qr-menu", "qr.read"],
    ["/admin/loyalty", "loyalty.read"],
    ["/admin/printers", "printing.read"],
    ["/admin/products", "catalog.read"],
    ["/admin/categories", "catalog.read"],
    ["/admin/modifiers", "catalog.read"],
    ["/admin/tables", "tables.read"],
    ["/admin/orders", "orders.read"],
    ["/admin/live", "dashboard.read"],
    ["/admin", "dashboard.read"],
  ];
  return mappings.find(([prefix]) => href === prefix || href.startsWith(`${prefix}/`))?.[1] ?? null;
}

function SidebarNavigation({
  navigation,
  pathname,
  compact,
  onNavigate,
}: {
  navigation: NavGroup[];
  pathname: string;
  compact: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav className="scrollbar-subtle flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {navigation.map((group) => (
        <div key={group.label} className="space-y-1">
          {!compact ? (
            <p className="px-3 pb-1 text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/45">
              {group.label}
            </p>
          ) : null}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href, item.exact);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                title={compact ? item.label : undefined}
                className={cn(
                  "group flex min-h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground/68 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active &&
                    "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_3px_0_0_var(--sidebar-primary)]",
                  compact && "justify-center px-0",
                )}
              >
                <item.icon
                  className={cn(
                    "size-[1.05rem] shrink-0 text-sidebar-foreground/55 transition-colors group-hover:text-sidebar-foreground",
                    active && "text-sidebar-primary",
                  )}
                />
                {!compact ? (
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-sidebar-primary/15 px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase text-sidebar-primary">
                        {item.badge}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  children,
  navigation,
  workspaceName = "Dixora",
  branchName = "Şube",
  userName = "Dixora Kullanıcısı",
  userRole = "Kullanıcı",
  platformMode = false,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const currentUser = useCurrentUser();
  const session = currentUser.data;
  const accessibleBranches = useAccessibleBranches({
    enabled: !platformMode && currentUser.isSuccess && Boolean(session?.tenant),
  });
  const approvalsPendingCount = useQuery({
    queryKey: adminKeys.approvalPendingCount(),
    queryFn: ({ signal }) => adminApi.approvalPendingCount(signal),
    enabled:
      !platformMode &&
      currentUser.isSuccess &&
      Boolean(session?.tenant) &&
      hasPermission(session, "orders.manage"),
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
  const resolvedWorkspaceName = session?.tenant?.name ?? workspaceName;
  const resolvedBranchName = session?.branch?.name ?? branchName;
  const resolvedUserName = session?.user.displayName ?? userName;
  const roleLabels: Record<string, string> = {
    SUPER_ADMIN: "Platform Yöneticisi",
    BUSINESS_OWNER: "İşletme Sahibi",
    BUSINESS_ADMIN: "Yönetici",
    BUSINESS_MANAGER: "İşletme Yöneticisi",
    ACCOUNTANT: "Muhasebe",
    CASHIER: "Kasiyer",
    WAITER: "Garson",
    KITCHEN: "Mutfak",
    BAR: "Bar",
  };
  const resolvedUserRole = session
    ? roleLabels[session.user.roleCode] ?? session.user.roleCode
    : userRole;
  const pendingApprovals = approvalsPendingCount.data?.pending ?? 0;
  const visibleNavigation = useMemo(
    () =>
      session
        ? navigation
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => {
                const requirement = permissionForNavigation(item.href);
                return requirement === null || hasPermission(session, requirement);
              }),
            }))
            .filter((group) => group.items.length > 0)
        : navigation,
    [navigation, session],
  ).map((group) => ({
    ...group,
    items: group.items.map((item) =>
      item.href === "/admin/approvals" && pendingApprovals > 0
        ? { ...item, badge: String(pendingApprovals) }
        : item,
    ),
  }));
  const logout = useLogout({
    onSettled: () => {
      // A full navigation drops the authenticated Router Cache as well as the
      // in-memory query state. This prevents a stale protected layout from
      // being shown after the HttpOnly cookies have been expired.
      window.location.replace(platformMode ? "/super-admin/login" : "/login");
    },
  });
  const switchBranch = useSwitchBranch({
    onSuccess: () => {
      router.refresh();
    },
    onError: (error) => {
      toast.error("Şube değiştirilemedi", { description: error.message });
    },
  });
  const initials = useMemo(
    () =>
      resolvedUserName
        .split(" ")
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase(),
    [resolvedUserName],
  );

  return (
    <div className="min-h-dvh bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:flex",
          compact ? "w-[76px]" : "w-[256px]",
        )}
      >
        <div
          className={cn(
            "flex h-[72px] shrink-0 items-center border-b border-sidebar-border px-5",
            compact && "justify-center px-2",
          )}
        >
          <BrandLogo
            theme="dark"
            withWordmark={!compact}
            className={cn("h-10 text-white", compact && "w-11")}
            priority
          />
        </div>
        <SidebarNavigation
          navigation={visibleNavigation}
          pathname={pathname}
          compact={compact}
        />
        <div className="border-t border-sidebar-border p-3">
          <Button
            variant="ghost"
            onClick={() => setCompact((value) => !value)}
            className="h-10 w-full justify-center text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label={compact ? "Menüyü genişlet" : "Menüyü daralt"}
          >
            {compact ? <PanelLeftOpen /> : <PanelLeftClose />}
            {!compact ? <span>Menüyü daralt</span> : null}
          </Button>
        </div>
      </aside>

      <div
        className={cn(
          "min-h-dvh transition-[padding] duration-200 lg:pl-[256px]",
          compact && "lg:pl-[76px]",
        )}
      >
        <header className="sticky top-0 z-30 flex h-[72px] items-center gap-3 border-b bg-background/92 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <Button
            variant="outline"
            size="icon"
            className="size-10 rounded-xl lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Menüyü aç"
          >
            <Menu />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="h-11 min-w-0 justify-start gap-3 px-2 text-left"
                />
              }
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Building2 className="size-4" />
              </span>
              <span className="hidden min-w-0 sm:block">
                <span className="block truncate text-sm font-semibold">{resolvedWorkspaceName}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">
                  {platformMode ? "Platform yönetimi" : resolvedBranchName}
                </span>
              </span>
              <ChevronDown className="hidden size-4 text-muted-foreground sm:block" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="start">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Çalışma alanı</DropdownMenuLabel>
                <DropdownMenuItem disabled>
                  {resolvedWorkspaceName} · {platformMode ? "Platform" : resolvedBranchName}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {!platformMode && accessibleBranches.isLoading ? (
                  <DropdownMenuItem disabled>
                    <Loader2 className="animate-spin" />
                    Şubeler yükleniyor
                  </DropdownMenuItem>
                ) : null}
                {!platformMode && accessibleBranches.isError ? (
                  <>
                    <DropdownMenuItem disabled>
                      <CircleAlert />
                      Şubeler yüklenemedi
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void accessibleBranches.refetch()}
                    >
                      <RefreshCw />
                      Tekrar dene
                    </DropdownMenuItem>
                  </>
                ) : null}
                {!platformMode && accessibleBranches.isSuccess
                  ? accessibleBranches.data.branches.map((branch) => {
                      const currentBranchId =
                        accessibleBranches.data.currentBranchId ?? session?.branch?.id;
                      const isCurrent = branch.id === currentBranchId;
                      const isSwitching =
                        switchBranch.isPending &&
                        switchBranch.variables?.branchId === branch.id;
                      return (
                        <DropdownMenuItem
                          key={branch.id}
                          disabled={
                            isCurrent ||
                            !accessibleBranches.data.canSwitch ||
                            switchBranch.isPending
                          }
                          onClick={() =>
                            switchBranch.mutate({ branchId: branch.id })
                          }
                        >
                          {isSwitching ? (
                            <Loader2 className="animate-spin" />
                          ) : isCurrent ? (
                            <Check />
                          ) : (
                            <Building2 />
                          )}
                          <span className="min-w-0 flex-1 truncate">{branch.name}</span>
                          {isCurrent ? (
                            <span className="text-xs text-muted-foreground">Aktif</span>
                          ) : null}
                        </DropdownMenuItem>
                      );
                    })
                  : null}
                {!platformMode &&
                accessibleBranches.isSuccess &&
                accessibleBranches.data.branches.length === 0 ? (
                  <DropdownMenuItem disabled>Kullanılabilir şube yok</DropdownMenuItem>
                ) : null}
                {!platformMode && switchBranch.isError ? (
                  <DropdownMenuItem disabled className="text-destructive">
                    <CircleAlert />
                    Şube değiştirilemedi
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
              {!platformMode ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                render={
                  <Link
                    href={platformMode ? "/super-admin/businesses" : "/admin/branch-settings"}
                  />
                }
              >
                {platformMode ? "İşletme yönetimi" : "Şube yönetimi"}
              </DropdownMenuItem>
              {!platformMode ? (
                <DropdownMenuItem render={<Link href="/support" />}>
                  <LifeBuoy />
                  Yardım ve destek
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="ml-auto flex items-center gap-1">
            {platformMode ? (
              <Button
                render={<Link href="/super-admin/businesses" />}
                variant="ghost"
                size="icon"
                className="hidden size-10 rounded-xl md:inline-flex"
                aria-label="İşletmelerde ara"
              >
                <Search />
              </Button>
            ) : null}
            <ThemeToggle />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" className="h-11 gap-2 rounded-xl px-1.5 sm:px-2" />
                }
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-[0.7rem] font-semibold text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-36 text-left lg:block">
                  <span className="block truncate text-xs font-semibold">{resolvedUserName}</span>
                  <span className="block truncate text-[0.68rem] font-normal text-muted-foreground">
                    {resolvedUserRole}
                  </span>
                </span>
                <ChevronDown className="hidden size-3.5 text-muted-foreground lg:block" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{resolvedUserName}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    render={<Link href={platformMode ? "/super-admin" : "/admin/settings"} />}
                  >
                    <Settings />
                    Profil ve tercihler
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled
                    title="Yardım merkezi yakında kullanıma açılacak"
                  >
                    <CircleHelp />
                    Yardım merkezi · yakında
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={logout.isPending}
                    onClick={() => logout.mutate()}
                  >
                    {logout.isPending ? <Loader2 className="animate-spin" /> : <LogOut />}
                    {logout.isPending ? "Çıkış yapılıyor" : "Güvenli çıkış"}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1680px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
          {children}
        </main>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[292px] gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
        >
          <SheetHeader className="h-[72px] justify-center border-b border-sidebar-border px-5 text-left">
            <SheetTitle className="sr-only">Ana menü</SheetTitle>
            <SheetDescription className="sr-only">Dixora uygulama menüsü</SheetDescription>
            <BrandLogo theme="dark" className="h-10 text-white" priority />
          </SheetHeader>
          <SidebarNavigation
            navigation={visibleNavigation}
            pathname={pathname}
            compact={false}
            onNavigate={() => setMobileOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
