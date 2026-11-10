/** 选择器瞬时状态：不复制宿主模型目录；每个会话实例独立持有菜单与操作通知。 */

import { createStore } from 'zustand/vanilla'
import { immer } from 'zustand/middleware/immer'

type Pane = 'effort' | 'models'

/** 操作归属当前模型及档位目录；effort 只是待确认预览，不是宿主已保存值。 */
export interface SelectionOperation {
  kind: 'model' | 'effort' | 'reset'
  routeKey: string
  effort?: string
}

/** 每个会话实例的瞬时 UI 状态；持久化模型和速度不在这里复制。 */
interface SelectorState {
  /** 用户期望弹层打开；关闭时可以仍挂载以完成退场。 */
  open: boolean

  /** 弹层 DOM 是否仍存在，由退场完成或兜底定时器清除。 */
  mounted: boolean

  /** 当前面板：强度滑杆或模型列表。 */
  pane: Pane

  /** 模型列表搜索文本，仅影响本地过滤。 */
  query: string

  /** 过滤后扁平模型列表中的键盘高亮索引。 */
  highlight: number

  /** 仅拖动中的预览；路由隔离防止模型切换时闪现旧档位。 */
  preview: { routeKey: string; effort: string } | undefined

  /** 会话选模/强度/重置的唯一进行中操作；序号防止迟到清理误伤后续操作。 */
  operation: (SelectionOperation & { id: number }) | null

  /** 当前操作 Toast 文本；模型目录读取错误仍由宿主目录保存。 */
  error: string | null

  /** 重复错误也生成新 Toast 身份；迟到 onDone 只能清理自己的序号。 */
  errorSequence: number

  /** 所有瞬时状态更新入口；不修改宿主模型目录。 */
  actions: {
    /** 打开指定面板并初始化本次交互，确保 DOM 已挂载。 */
    show(pane: Pane): void

    /** 触发退场并丢弃强度预览，暂不卸载 DOM。 */
    close(): void

    /** 仅在仍关闭时卸载，避免旧计时器破坏快速重开。 */
    unmount(): void

    /** 进入模型列表，重置搜索并定位当前模型。 */
    showModels(highlight: number): void

    /** 在同一弹层内切换面板，不改动宿主选择。 */
    setPane(pane: Pane): void

    /** 更新过滤条件并把高亮移回首项。 */
    search(query: string): void

    /** 记录键盘/鼠标所指向的扁平列表索引。 */
    highlight(index: number): void

    /** 设置拖动预览；清理只影响指定路由，保存期间不接受新手势。 */
    preview(routeKey: string, effort: string | undefined): void

    /** 原子取得提交资格并把手势预览交给操作；失败返回 null。 */
    startSelection(operation: SelectionOperation): number | null

    /** 仅结束对应序号的操作；已确认显示仍由宿主目录决定。 */
    finishSelection(id: number): void

    /** 生成操作提示；null 只清理文本，不产生新的通知序号。 */
    reportError(message: string | null): void

    /** 按序号关闭 Toast，忽略已过期的动画回调。 */
    dismissError(sequence: number): void
  }
}

/** 每个选择器实例独立持有；DSH 目录仍是模型选择的唯一持久化来源。 */
export function createSelectorStore() {
  let operationSequence = 0
  return createStore<SelectorState>()(
    immer((set, get) => ({
      open: false,
      mounted: false,
      pane: 'effort',
      query: '',
      highlight: 0,
      preview: undefined,
      operation: null,
      error: null,
      errorSequence: 0,
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
        preview: (routeKey, effort) =>
          set((state) => {
            if (effort === undefined) {
              if (state.preview?.routeKey === routeKey) state.preview = undefined
            } else if (!state.operation) {
              if (state.preview?.routeKey !== routeKey || state.preview.effort !== effort)
                state.preview = { routeKey, effort }
            }
          }),
        startSelection: (operation) => {
          if (get().operation) return null
          const id = ++operationSequence
          set((state) => {
            state.operation = { ...operation, id }
            state.preview = undefined
            state.error = null
          })
          return id
        },
        finishSelection: (id) =>
          set((state) => {
            if (state.operation?.id === id) state.operation = null
          }),
        reportError: (message) =>
          set((state) => {
            state.error = message
            if (message !== null) state.errorSequence++
          }),
        dismissError: (sequence) =>
          set((state) => {
            if (state.errorSequence === sequence) state.error = null
          }),
      },
    })),
  )
}

export type SelectorStore = ReturnType<typeof createSelectorStore>
