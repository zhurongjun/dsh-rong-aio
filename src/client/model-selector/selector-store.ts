import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'

type Pane = 'effort' | 'models'

interface SelectorState {
  open: boolean
  mounted: boolean
  pane: Pane
  query: string
  highlight: number
  preview: string | undefined
  saving: boolean
  error: string | null
  actions: {
    show(pane: Pane): void
    close(): void
    unmount(): void
    showModels(highlight: number): void
    setPane(pane: Pane): void
    search(query: string): void
    highlight(index: number): void
    preview(id: string | undefined): void
    startSaving(): boolean
    finishSaving(): void
    reportError(message: string | null): void
  }
}

/** 每个选择器实例独立持有；DSH 目录仍是模型选择的唯一持久化来源。 */
export function createSelectorStore() {
  return createStore<SelectorState>()(
    immer((set, get) => ({
      open: false,
      mounted: false,
      pane: 'effort',
      query: '',
      highlight: 0,
      preview: undefined,
      saving: false,
      error: null,
      actions: {
        show: (pane) =>
          set((state) => {
            state.query = ''
            state.error = null
            state.preview = undefined
            state.pane = pane
            state.open = true
            state.mounted = true
          }),
        close: () =>
          set((state) => {
            state.open = false
            state.preview = undefined
          }),
        unmount: () =>
          set((state) => {
            if (!state.open) state.mounted = false
          }),
        showModels: (highlight) =>
          set((state) => {
            state.query = ''
            state.highlight = highlight
            state.pane = 'models'
          }),
        setPane: (pane) =>
          set((state) => {
            state.pane = pane
          }),
        search: (query) =>
          set((state) => {
            state.query = query
            state.highlight = 0
          }),
        highlight: (index) =>
          set((state) => {
            state.highlight = index
          }),
        preview: (id) =>
          set((state) => {
            state.preview = id
          }),
        startSaving: () => {
          if (get().saving) return false
          set((state) => {
            state.saving = true
            state.error = null
          })
          return true
        },
        finishSaving: () =>
          set((state) => {
            state.saving = false
            state.preview = undefined
          }),
        reportError: (message) =>
          set((state) => {
            state.error = message
          }),
      },
    })),
  )
}

export type SelectorStore = ReturnType<typeof createSelectorStore>
