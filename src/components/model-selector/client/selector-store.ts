import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

type Pane = 'effort' | 'models'

export interface SelectionOperation {
  kind: 'model' | 'effort' | 'reset'
  routeKey: string
  effort?: string
}

export interface SelectorState {
  open: boolean
  mounted: boolean
  pane: Pane
  query: string
  highlight: number
  preview: { routeKey: string; effort: string } | undefined
  operation: (SelectionOperation & { id: number }) | null
  error: string | null
  errorSequence: number
  errorSource: 'load' | 'select'
  actions: {
    show(pane: Pane): void
    close(): void
    unmount(): void
    showModels(highlight: number): void
    setPane(pane: Pane): void
    search(query: string): void
    highlight(index: number): void
    preview(routeKey: string, effort: string | undefined): void
    startLoad(): void
    startSelection(operation: SelectionOperation): number | null
    finishSelection(id: number): void
    reportError(message: string | null): void
    dismissError(sequence: number): void
    dispose(): void
  }
}

export function createSelectorStore() {
  let operationSequence = 0
  let unmountTimer: ReturnType<typeof setTimeout> | undefined

  const clearUnmountTimer = () => {
    if (unmountTimer === undefined) return
    clearTimeout(unmountTimer)
    unmountTimer = undefined
  }

  return createStore<SelectorState>((set, get) => ({
    open: false,
    mounted: false,
    pane: 'effort',
    query: '',
    highlight: 0,
    preview: undefined,
    operation: null,
    error: null,
    errorSequence: 0,
    errorSource: 'load',

    actions: {
      show: (pane) => {
        clearUnmountTimer()
        set({ query: '', error: null, preview: undefined, pane, open: true, mounted: true })
      },

      close: () => {
        clearUnmountTimer()
        set({ open: false, preview: undefined })
        if (!get().mounted) return
        unmountTimer = setTimeout(() => {
          unmountTimer = undefined
          set((state) => (state.open ? state : { mounted: false }))
        }, 180)
      },

      unmount: () => {
        clearUnmountTimer()
        set((state) => (state.open ? state : { mounted: false }))
      },

      showModels: (highlight) => set({ query: '', highlight, pane: 'models' }),
      setPane: (pane) => set({ pane }),
      search: (query) => set({ query, highlight: 0 }),
      highlight: (index) => set({ highlight: index }),

      preview: (routeKey, effort) =>
        set((state) => {
          if (effort === undefined) {
            return state.preview?.routeKey === routeKey ? { preview: undefined } : state
          }
          if (state.operation) return state
          if (state.preview?.routeKey !== routeKey || state.preview.effort !== effort) {
            return { preview: { routeKey, effort } }
          }
          return state
        }),

      startLoad: () => set({ errorSource: 'load' }),

      startSelection: (operation) => {
        if (get().operation) return null
        const id = ++operationSequence
        set({
          operation: { ...operation, id },
          preview: undefined,
          error: null,
          errorSource: 'select',
        })
        return id
      },

      finishSelection: (id) =>
        set((state) => (state.operation?.id === id ? { operation: null } : state)),

      reportError: (message) =>
        set((state) => ({
          error: message,
          errorSequence: message !== null ? state.errorSequence + 1 : state.errorSequence,
        })),

      dismissError: (sequence) =>
        set((state) => (state.errorSequence === sequence ? { error: null } : state)),

      dispose: () => clearUnmountTimer(),
    },
  }))
}

export type SelectorStore = ReturnType<typeof createSelectorStore>

export function useEffortPreview(store: SelectorStore, routeKey: string, selected?: string) {
  return useStore(store, (state) => {
    if (state.operation?.routeKey === routeKey && state.operation.kind !== 'model') {
      return state.operation.effort ?? selected
    }
    return state.preview?.routeKey === routeKey ? state.preview.effort : selected
  })
}
