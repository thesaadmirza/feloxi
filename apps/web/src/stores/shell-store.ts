import { create } from "zustand";

type ShellStore = {
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
};

/// UI state shared between the sidebar, page headers and the command menu.
export const useShellStore = create<ShellStore>((set) => ({
  navOpen: false,
  setNavOpen: (navOpen) => set({ navOpen }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
