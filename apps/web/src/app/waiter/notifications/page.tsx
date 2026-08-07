import type { Metadata } from "next";

import { WaiterNotifications } from "@/components/waiter/waiter-notifications";

export const metadata: Metadata = { title: "Garson Bildirimleri" };

export default function WaiterNotificationsPage() {
  return <WaiterNotifications />;
}
