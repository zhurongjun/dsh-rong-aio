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

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function sameStyle(previous: CSSProperties | null, next: CSSProperties): boolean {
  if (!previous) return false
  const prevKeys = Object.keys(previous) as (keyof CSSProperties)[]
  const nextKeys = Object.keys(next) as (keyof CSSProperties)[]
  return prevKeys.length === nextKeys.length && nextKeys.every((key) => previous[key] === next[key])
}

function buildPositionStyle(
  placement: PopoverPlacement,
  anchor: HTMLElement,
  surface: HTMLDivElement,
  left: number,
  top: number,
  maxHeight: number | undefined,
): CSSProperties {
  if (placement === 'side') {
    const rect = anchor.getBoundingClientRect()
    const originX = clamp(rect.left + rect.width / 2 - left, 0, surface.offsetWidth)
    const originY = clamp(rect.top + rect.height / 2 - top, 0, surface.offsetHeight)
    return { position: 'fixed', left, top, transformOrigin: `${originX}px ${originY}px` }
  }
  if (placement === 'below-end') {
    return { position: 'fixed', left, top, maxHeight: maxHeight ?? MAX_LIST_HEIGHT }
  }
  return { position: 'fixed', left, top }
}

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

    const middleware: Middleware[] = [
      offset(options.placement === 'side' ? { mainAxis: 6, alignmentAxis: -4 } : POPOVER_GAP),
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

      const next = buildPositionStyle(
        options.placement,
        anchor,
        surface,
        Math.round(x),
        Math.round(y),
        clampedMaxHeight,
      )
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
