import { create } from "zustand"

interface UiState {
  sidebarCollapsed: boolean
  mobileNavigationOpen: boolean
  commandPaletteOpen: boolean
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleSidebar: () => void
  setMobileNavigationOpen: (open: boolean) => void
  setCommandPaletteOpen: (open: boolean) => void
  reset: () => void
}

const initialState = {
  sidebarCollapsed: false,
  mobileNavigationOpen: false,
  commandPaletteOpen: false,
}

export const useUiStore = create<UiState>((set) => ({
  ...initialState,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setMobileNavigationOpen: (mobileNavigationOpen) =>
    set({ mobileNavigationOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) =>
    set({ commandPaletteOpen }),
  reset: () => set(initialState),
}))
