/** 受管浮层锚点定位控制器：在 React 18 Layout Ref 挂载期同步定位并管理视口与 ResizeObserver 监听。 */

import type { CSSProperties } from 'react'
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

function sameStyle(previous: CSSProperties | null, next: CSSProperties): boolean {
  if (!previous) return false
  const prevKeys = Object.keys(previous) as (keyof CSSProperties)[]
  const nextKeys = Object.keys(next) as (keyof CSSProperties)[]
  return prevKeys.length === nextKeys.length && nextKeys.every((key) => previous[key] === next[key])
}

function computePosition(
  anchorEl: HTMLElement,
  surfaceEl: HTMLElement,
  placement: PopoverPlacement,
): CSSProperties {
  const anchor = anchorEl.getBoundingClientRect()
  const viewport = window.visualViewport
  const vLeft = viewport?.offsetLeft ?? 0
  const vTop = viewport?.offsetTop ?? 0
  const vw = viewport?.width ?? window.innerWidth
  const vh = viewport?.height ?? window.innerHeight
  const margin = 12
  const gap = 8

  if (placement === 'above-end') {
    const width = surfaceEl.offsetWidth
    const height = surfaceEl.offsetHeight
    const x = Math.max(vLeft + margin, Math.min(anchor.right - width, vLeft + vw - width - margin))
    const above = anchor.top - gap - height
    const y =
      above >= vTop + margin ? above : Math.min(anchor.bottom + gap, vTop + vh - height - margin)
    return { left: x, top: Math.max(vTop + margin, y) }
  }

  if (placement === 'side') {
    const width = surfaceEl.offsetWidth
    const height = surfaceEl.offsetHeight
    const preferredLeft = anchor.right + 6
    const x = Math.max(
      vLeft + margin,
      Math.min(
        preferredLeft + width <= vLeft + vw - margin ? preferredLeft : anchor.left - 6 - width,
        vLeft + vw - width - margin,
      ),
    )
    const y = Math.max(vTop + margin, Math.min(anchor.top - 4, vTop + vh - height - margin))
    const originX = Math.max(0, Math.min(width, anchor.left + anchor.width / 2 - x))
    const originY = Math.max(0, Math.min(height, anchor.top + anchor.height / 2 - y))
    return { left: x, top: y, transformOrigin: `${originX}px ${originY}px` }
  }

  const width = Math.min(surfaceEl.offsetWidth, Math.max(0, vw - margin * 2))
  const top = Math.max(vTop + margin, anchor.bottom + gap)
  const bottom = Math.max(margin, vh - (anchor.top - vTop) + gap)
  const below = Math.max(0, vTop + vh - top - margin)
  const above = Math.max(0, anchor.top - vTop - gap - margin)
  const opensBelow = below >= Math.min(surfaceEl.scrollHeight, above) || below >= above
  return {
    position: 'fixed',
    left: Math.max(vLeft + margin, Math.min(anchor.right - width, vLeft + vw - width - margin)),
    ...(opensBelow ? { top } : { bottom }),
    maxHeight: Math.min(344, opensBelow ? below : above),
  }
}

/** 创建浮层锚点定位控制器；所有 bind* 回调引用稳定，可安全传给 React 18 ref。 */
export function createAnchoredPopover(options: AnchoredPopoverOptions) {
  const store = createStore<{ position: CSSProperties | null }>(() => ({ position: null }))
  let anchorEl: HTMLElement | null = null
  let surfaceEl: HTMLDivElement | null = null
  let observer: ResizeObserver | undefined
  let mountAbort: AbortController | undefined

  const getAnchor = () => anchorEl
  const focusAnchor = () => anchorEl?.focus()

  const place = () => {
    if (!anchorEl || !surfaceEl) return
    const next = computePosition(anchorEl, surfaceEl, options.placement)
    if (!sameStyle(store.getState().position, next)) {
      store.setState({ position: next })
    }
  }

  const bindAnchor = (node: HTMLElement | null) => {
    anchorEl = node
    if (node && surfaceEl) place()
  }

  const bindContent = (node: HTMLElement | null) => {
    if (!node) return
    observer?.observe(node)
    place()
  }

  const bindSurface = (node: HTMLDivElement | null) => {
    observer?.disconnect()
    observer = undefined
    mountAbort?.abort()
    mountAbort = undefined
    surfaceEl = node
    if (!node) {
      if (store.getState().position !== null) store.setState({ position: null })
      return
    }

    place()
    observer = new ResizeObserver(place)
    observer.observe(node)
    if (anchorEl) observer.observe(anchorEl)
    if (node.firstElementChild instanceof HTMLElement) observer.observe(node.firstElementChild)

    mountAbort = new AbortController()
    const { signal } = mountAbort
    window.addEventListener('resize', place, { signal })
    window.addEventListener('scroll', place, { capture: true, signal })
    window.visualViewport?.addEventListener('resize', place, { signal })
    window.visualViewport?.addEventListener('scroll', place, { signal })
    options.onMount?.(node, signal, { getAnchor })
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
