import { create } from "zustand";
import type { WebSocketStatus } from "@/hooks/use-websocket";

export const useConnectionStore = create<{
  online: boolean;
  status: WebSocketStatus;
  update: (online: boolean, status: WebSocketStatus) => void;
}>((set) => ({ online: true, status: "connecting", update: (online, status) => set({ online, status }) }));

export function connectionLabel(online: boolean, status: WebSocketStatus): string {
  if (!online || status === "offline") return "Çevrimdışı";
  if (status === "open") return "Canlı bağlantı açık";
  return "Yeniden bağlanıyor";
}
