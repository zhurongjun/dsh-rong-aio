/** 受管浮层锚点定位控制器：基于 @floating-ui/dom 在 React 18 Callback Ref 挂载期同步定位并管理视口与缩放监听。 */

import { useCallback, useRef, useState, type CSSProperties } from 'react'
import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size,
  type Middleware,
  type Placement,
} from '@floating-ui/dom'
import { createStore } from 'zustand/vanilla'

export type PopoverPlacement = 'above-end' | 'side' | 'below-end'

interface AnchoredPopoverOptions {
  placement: PopoverPlacement
  onMount?: (
    surface: HTMLElement,
    signal: AbortSignal,
    helpers: { getAnchor: () => HTMLElement | null },
  ) => void
}

const VIEWPORT_MARGIN = 12
const POPOVER_GAP = 8
const MAX_LIST_HEIGHT = 344

const PLACEMENT_MAP: Record<PopoverPlacement, Placement> = {
  'above-end': 'top-end',
  side: 'right-start',
  'below-end': 'bottom-end',
}

function sameStyle(previous: CSSProperties | null, next: CSSProperties): boolean {
  if (!previous) return false
  const prevKeys = Object.keys(previous) as (keyof CSSProperties)[]
  const nextKeys = Object.keys(next) as (keyof CSSProperties)[]
  return prevKeys.length === nextKeys.length && nextKeys.every((key) => previous[key] === next[key])
}

/** 创建浮层锚点定位控制器；所有 bind* 回调引用稳定，可安全传给 React 18 ref。 */
export function createAnchoredPopover(options: AnchoredPopoverOptions) {
  const store = createStore<{ position: CSSProperties | null }>(() => ({ position: null }))
  let anchorEl: HTMLElement | null = null
  let surfaceEl: HTMLDivElement | null = null
  let stopAutoUpdate: (() => void) | undefined
  let mountAbort: AbortController | undefined
  let epoch = 0
  let placeSequence = 0

  const getAnchor = () => anchorEl
  const focusAnchor = () => anchorEl?.focus()

  const place = () => {
    const anchor = anchorEl
    const surface = surfaceEl
    if (!anchor || !surface || !surface.isConnected) return
    const currentEpoch = epoch
    const seq = ++placeSequence
    let clampedMaxHeight: number | undefined

    const middleware: Middleware[] =
      options.placement === 'side'
        ? [
            offset({ mainAxis: 6, alignmentAxis: -4 }),
            flip({ padding: VIEWPORT_MARGIN }),
            shift({ padding: VIEWPORT_MARGIN }),
          ]
        : [
            offset(POPOVER_GAP),
            flip({ padding: VIEWPORT_MARGIN }),
            shift({ padding: VIEWPORT_MARGIN }),
          ]

    if (options.placement === 'below-end') {
      middleware.push(
        size({
          padding: VIEWPORT_MARGIN,
          apply({ availableHeight }) {
            clampedMaxHeight = Math.min(MAX_LIST_HEIGHT, Math.max(0, Math.floor(availableHeight)))
          },
        }),
      )
    }

    void computePosition(anchor, surface, {
      strategy: 'fixed',
      placement: PLACEMENT_MAP[options.placement],
      middleware,
    }).then(({ x, y }) => {
      if (
        currentEpoch !== epoch ||
        seq !== placeSequence ||
        anchorEl !== anchor ||
        surfaceEl !== surface ||
        !surface.isConnected
      ) {
        return
      }
      const left = Math.round(x)
      const top = Math.round(y)
      let next: CSSProperties
      if (options.placement === 'side') {
        const rect = anchor.getBoundingClientRect()
        const originX = Math.max(
          0,
          Math.min(surface.offsetWidth, rect.left + rect.width / 2 - left),
        )
        const originY = Math.max(
          0,
          Math.min(surface.offsetHeight, rect.top + rect.height / 2 - top),
        )
        next = {
          position: 'fixed',
          left,
          top,
          transformOrigin: `${originX}px ${originY}px`,
        }
      } else if (options.placement === 'below-end') {
        next = {
          position: 'fixed',
          left,
          top,
          maxHeight: clampedMaxHeight ?? MAX_LIST_HEIGHT,
        }
      } else {
        next = { position: 'fixed', left, top }
      }
      if (!sameStyle(store.getState().position, next)) {
        store.setState({ position: next })
      }
    })
  }

  const syncTracking = () => {
    epoch++
    stopAutoUpdate?.()
    stopAutoUpdate = undefined
    if (!anchorEl || !surfaceEl) return
    stopAutoUpdate = autoUpdate(anchorEl, surfaceEl, place)
  }

  const bindAnchor = (node: HTMLElement | null) => {
    if (node === anchorEl) return
    anchorEl = node
    syncTracking()
  }

  const bindContent = (node: HTMLElement | null) => {
    if (node) place()
  }

  const bindSurface = (node: HTMLDivElement | null) => {
    if (node === surfaceEl) return
    mountAbort?.abort()
    mountAbort = undefined
    surfaceEl = node
    syncTracking()
    if (!node) {
      if (store.getState().position !== null) store.setState({ position: null })
      return
    }
    mountAbort = new AbortController()
    options.onMount?.(node, mountAbort.signal, { getAnchor })
  }

  return {
    store,
    surface: () => surfaceEl,
    getAnchor,
    focusAnchor,
    place,
    bindAnchor,
    bindContent,
    bindSurface,
  }
}

export type AnchoredPopover = ReturnType<typeof createAnchoredPopover>

/** 为输入框插槽组件提供触发器引用与 Toast 宿主卡片锚点，不在渲染期间读取 ref.current。 */
export function useComposerToastAnchor() {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [toastAnchor, setToastAnchor] = useState<HTMLElement | null>(null)

  const bindTrigger = useCallback((node: HTMLButtonElement | null) => {
    triggerRef.current = node
    const card = node?.closest<HTMLElement>('[data-composer-card]') ?? null
    setToastAnchor((previous) => (previous === card ? previous : card))
  }, [])

  return { triggerRef, bindTrigger, toastAnchor }
}
