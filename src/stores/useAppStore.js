import { create } from "zustand";
import { emptyProviderFields } from "../lib/providerDefs";
import { createDefaultState } from "../lib/storyState";

export const useAppStore = create((set, get) => ({
  // Core State
  appState: createDefaultState(),
  loaded: false,
  status: { label: "待命", tone: "idle" },
  
  // UI State
  ui: {
    isGenerating: false,
    instruction: "",
    streamDraft: null,
    summaryDraft: null,
    modals: {
      story: false,
      template: false,
      settings: false,
    },
    tabs: {
      library: "stories",
      inspector: "setup",
      main: "timeline",
    },
    sidebarOpen: true,
  },

  // Settings State
  settings: {
    provider: "openai_compatible",
    fields: emptyProviderFields,
    drafts: {},
    modelOptions: null,
    testResult: null,
    busy: { testing: false, listing: false },
  },

  // Actions
  setAppState: (updater) =>
    set((state) => ({
      appState: typeof updater === "function" ? updater(state.appState) : updater,
    })),
    
  setLoaded: (loaded) => set({ loaded }),
  setStatus: (label, tone = "idle") => set({ status: { label, tone } }),

  // UI Actions
  setUI: (updater) => set((state) => ({
    ui: typeof updater === "function" ? updater(state.ui) : { ...state.ui, ...updater }
  })),

  updateModal: (name, isOpen) => set((state) => ({
    ui: {
      ...state.ui,
      modals: { ...state.ui.modals, [name]: isOpen }
    }
  })),

  // Settings Actions
  setSettings: (updater) => set((state) => ({
    settings: typeof updater === "function" ? updater(state.settings) : { ...state.settings, ...updater }
  })),

  // Shortcuts / Helpers
  toggleSidebar: () => set((state) => ({
    ui: { ...state.ui, sidebarOpen: !state.ui.sidebarOpen }
  })),

  resetInstruction: () => set((state) => ({
    ui: { ...state.ui, instruction: "" }
  })),
}));
