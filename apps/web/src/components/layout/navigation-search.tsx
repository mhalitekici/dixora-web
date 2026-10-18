"use client"

import { LifeBuoy, Search, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import type { NavGroup } from "./nav-config"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export function NavigationSearch({ navigation }: { navigation: NavGroup[] }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const searchableNavigation = [
    ...navigation,
    {
      label: "Hesap ve yardım",
      items: [
        { label: "Hesabım ve parola", href: "/profile", icon: UserRound },
        { label: "Yardım ve destek", href: "/support", icon: LifeBuoy },
      ],
    },
  ]
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    document.addEventListener("keydown", keydown)
    return () => document.removeEventListener("keydown", keydown)
  }, [])

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-10 rounded-xl"
        aria-label="Panel ve işlem ara"
        title="Panel ve işlem ara (Ctrl+K)"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" />
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Panel ve işlem ara"
        description="Yetkiniz olan ekranları bulun. Seçmek için ok tuşlarını ve Enter tuşunu kullanın."
      >
        <CommandInput placeholder="Masa, yazıcı, sadakat, rapor…" />
        <CommandList>
          <CommandEmpty>Bu aramaya uygun ekran bulunamadı.</CommandEmpty>
          {searchableNavigation.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.href}
                  value={`${item.label} ${group.label}`}
                  onSelect={() => {
                    setOpen(false)
                    router.push(item.href)
                  }}
                >
                  <item.icon aria-hidden="true" />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  )
}
