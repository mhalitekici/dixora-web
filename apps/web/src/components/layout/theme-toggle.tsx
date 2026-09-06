"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useManagedThemeStore } from "@/stores/managed-theme-store";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // On screens where the business pins the look, the toggle would change
  // nothing — next-themes is being forced — so it is hidden rather than left
  // there to be pressed with no effect.
  const managedMode = useManagedThemeStore((state) => state.mode);

  if (managedMode === "LIGHT" || managedMode === "DARK") {
    return null;
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-10 rounded-xl"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Renk temasını değiştir"
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}
