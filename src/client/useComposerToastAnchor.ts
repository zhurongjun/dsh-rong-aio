/** 为输入框插槽组件提供触发器引用与 Toast 宿主卡片锚点，不在渲染期间读取 ref.current。 */

import { useCallback, useRef, useState } from 'react'

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
