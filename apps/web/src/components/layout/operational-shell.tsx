"use client";

import {
  Bell,
  ChevronDown,
  Loader2,
  LockKeyhole,
  LogOut,
  Wifi,
  WifiOff,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { operationalLinks } from "@/components/layout/nav-config";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { useCurrentUser, useLogout } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type OperationalMode = keyof typeof operationalLinks;

export function OperationalShell({
  mode,
  children,
  userName,
  stationName,
  fullBleed = false,
}: {
  mode: OperationalMode;
  children: ReactNode;
  userName: string;
  stationName?: string;
  fullBleed?: boolean;
}) {
  const pathname = usePathname();
  const [online, setOnline] = useState(true);
  const currentUser = useCurrentUser();
  const resolvedUserName = currentUser.data?.user.displayName ?? userName;
  const resolvedStationName =
    stationName ?? currentUser.data?.branch?.name ?? "Dixora Şubesi";
  const logout = useLogout({
    onSettled: () => {
      window.location.replace("/login");
    },
  });

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const links = operationalLinks[mode];
  const modeLabel = mode === "waiter" ? "Garson" : mode === "cashier" ? "Kasa" : "Mutfak";

  return (
    <div className={cn("min-h-dvh bg-background", mode === "kitchen" && "bg-[#191717]")}>
      <header
        className={cn(
          "sticky top-0 z-40 flex h-16 items-center gap-3 border-b bg-background/94 px-3 backdrop-blur-xl sm:px-5",
          mode === "kitchen" && "border-white/8 bg-[#201d1d]/95 text-white",
        )}
      >
        <Link href={`/${mode}`} className="flex shrink-0 items-center">
          <BrandLogo
            theme={mode === "kitchen" ? "dark" : "light"}
            withWordmark={false}
            className="size-10"
            priority
          />
        </Link>
        <div className="h-7 w-px bg-border dark:bg-white/10" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{resolvedStationName}</p>
            <Badge
              variant="outline"
              className={cn(
                "hidden h-5 rounded-full text-[0.58rem] sm:inline-flex",
                mode === "kitchen" && "border-white/10 text-white/60",
              )}
            >
              {modeLabel}
            </Badge>
          </div>
          <p
            className={cn(
              "truncate text-[0.65rem] text-muted-foreground",
              mode === "kitchen" && "text-white/40",
            )}
          >
            {resolvedUserName}
          </p>
        </div>

        <nav className="ml-5 hidden items-center gap-1 lg:flex">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  mode === "kitchen" &&
                    "text-white/50 hover:bg-white/8 hover:text-white",
                  mode === "kitchen" && active && "bg-white text-[#242121] hover:bg-white hover:text-[#242121]",
                )}
              >
                <link.icon className="size-4" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          <span
            className={cn(
              "hidden h-8 items-center gap-1.5 rounded-full px-2.5 text-[0.65rem] font-semibold sm:flex",
              online
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-red-500/10 text-red-700 dark:text-red-300",
            )}
          >
            {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
            {online ? "Bağlı" : "Çevrimdışı"}
          </span>
          {mode !== "kitchen" ? <ThemeToggle /> : null}
          {mode === "waiter" ? (
            <Button
              render={<Link href="/waiter/notifications" />}
              variant="ghost"
              size="icon"
              className="size-10 rounded-xl"
              aria-label="Bildirimler"
              title="Bildirimler"
            >
              <Bell />
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className={cn(
                    "h-10 gap-1 rounded-xl px-1.5",
                    mode === "kitchen" && "text-white hover:bg-white/8 hover:text-white",
                  )}
                />
              }
            >
              <Avatar className="size-8">
                <AvatarFallback className="bg-brand text-[0.65rem] font-bold text-brand-foreground">
                  {resolvedUserName
                    .split(" ")
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="size-3.5 opacity-50" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{resolvedUserName}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  <LockKeyhole />
                  Hızlı kilitle
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  {logout.isPending ? <Loader2 className="animate-spin" /> : <LogOut />}
                  {logout.isPending ? "Çıkış yapılıyor" : "Kullanıcı değiştir"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main
        className={cn(
          "pb-20 lg:pb-0",
          fullBleed ? "min-h-[calc(100dvh-4rem)]" : "mx-auto w-full max-w-[1680px] p-3 sm:p-5",
          mode === "kitchen" && "text-white",
        )}
      >
        {children}
      </main>

      <nav
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 border-t bg-background/96 px-2 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl lg:hidden",
          mode === "kitchen" && "border-white/8 bg-[#201d1d]/96",
        )}
      >
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[0.62rem] font-semibold text-muted-foreground",
                active && "bg-brand-soft text-brand",
                mode === "kitchen" && "text-white/45",
                mode === "kitchen" && active && "bg-white/8 text-brand",
              )}
            >
              <link.icon className="size-[1.15rem]" />
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
