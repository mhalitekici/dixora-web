"use client"

import { useQuery } from "@tanstack/react-query"
import { MonitorDot } from "lucide-react"
import Link from "next/link"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { api } from "@/lib/api"

type OpenShift = { id: string; cashier_name: string | null; opened_at: string } | null

/**
 * Stops a cashier walking away from an open till.
 *
 * Logging out used to end the session silently, leaving the shift open with no
 * counted cash — so the next cashier inherited someone else's drawer and the
 * handover was never recorded.
 */
export function ShiftLogoutGuard({
  open,
  onOpenChange,
  onLogoutAnyway,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogoutAnyway: () => void
}) {
  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: ({ signal }) => api.get<OpenShift>("shifts/current", { signal }),
    enabled: open,
  })

  const shift = shiftQuery.data

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {shift ? "Vardiyanız hâlâ açık" : "Çıkış yapılsın mı?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {shift
              ? "Çıkmadan önce vardiyayı kapatın: sayılan nakdi girin ya da devri yapın. Aksi hâlde kasa sizin adınıza açık kalır."
              : "Oturumunuz kapatılacak."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Vazgeç</AlertDialogCancel>
          {shift ? (
            <AlertDialogAction render={<Link href="/cashier/shift" />}>
              <MonitorDot />
              Vardiyayı kapat
            </AlertDialogAction>
          ) : (
            <AlertDialogAction onClick={onLogoutAnyway}>Çıkış yap</AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
