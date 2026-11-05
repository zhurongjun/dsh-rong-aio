/** 设置导航图标适配：在本组件挂载范围内追加裂盾装饰，卸载恢复宿主导航。 */

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArmorIcon } from './ArmorIcon.tsx'

export const SETTINGS_LABEL = '破甲模式'

/**
 * rc.5 的设置导航对扩展固定使用齿轮，没有公开图标插槽。
 * 借 settings.action 的挂载周期，仅在当前设置面板内定位本组件的导航项，
 * 追加独立装饰节点；不改原 SVG、按钮或宿主状态，卸载后恢复原图标。
 * 升级时复核 data-shortcut-modal、nav/button 和标签结构；不匹配则保留原生齿轮。
 */
export function SettingsNavIcon() {
  const anchor = useRef<HTMLSpanElement>(null)
  const [target, setTarget] = useState<HTMLSpanElement>()
  useLayoutEffect(() => {
    const nav = anchor.current?.closest('[data-shortcut-modal="settings"]')?.querySelector('nav')
    if (!nav) return
    let marker: HTMLSpanElement | undefined

    /** 在当前设置面板内精确定位唯一导航项；节点变化时重新挂载装饰，结构不匹配则撤销。 */
    const update = () => {
      const matches = [...nav.querySelectorAll('button')].filter(
        (button) => button.textContent?.trim() === SETTINGS_LABEL,
      )
      const button = matches.length === 1 ? matches[0] : undefined
      if (button && marker?.parentElement === button) return
      marker?.remove()
      marker = undefined
      if (button?.firstElementChild?.tagName.toLowerCase() === 'svg') {
        marker = document.createElement('span')
        marker.className = 'rong-inject-settings-icon'
        marker.setAttribute('aria-hidden', 'true')
        button.prepend(marker)
      }
      setTarget(marker)
    }

    update()
    const observer = new MutationObserver(update)
    observer.observe(nav, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      marker?.remove()
    }
  }, [])
  return (
    <>
      <span ref={anchor} hidden />
      {target && createPortal(<ArmorIcon active size={16} />, target)}
    </>
  )
}
