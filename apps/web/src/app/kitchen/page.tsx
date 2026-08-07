import type { Metadata } from "next";

import { KitchenDisplay } from "@/components/kitchen/kitchen-display";

export const metadata: Metadata = { title: "Mutfak Sipariş Ekranı" };

export default function KitchenPage() {
  return <KitchenDisplay />;
}
