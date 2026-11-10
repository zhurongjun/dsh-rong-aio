/** 选择器按钮的交互边界：真正不可用使用原生 disabled，短暂忙碌保留外观和焦点。 */

import { forwardRef, type ButtonHTMLAttributes } from 'react'

interface Props extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'aria-disabled' | 'aria-busy'
> {
  /** 请求进行中只阻止激活；不触发 disabled 颜色，也不移走当前键盘焦点。 */
  busy?: boolean

  /** 面板退场期间停止交互并退出 Tab 顺序，保留退场前的视觉状态。 */
  inactive?: boolean
}

/** 保留既有紧凑几何与 SVG；鼠标、Enter/Space 合成点击及自定义按键统一经过忙碌保护。 */
export const SelectionButton = forwardRef<HTMLButtonElement, Props>(function SelectionButton(
  { busy = false, disabled = false, inactive = false, onClick, onKeyDown, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type="button"
      disabled={disabled}
      tabIndex={inactive ? -1 : props.tabIndex}
      aria-disabled={disabled || busy || inactive || undefined}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (disabled || busy || inactive) {
          event.preventDefault()
          return
        }
        onClick?.(event)
      }}
      onKeyDown={(event) => {
        // 忙碌期间仍让 Escape/Tab 交给外层关闭与焦点循环，不激活自定义选择逻辑。
        if (!disabled && !busy && !inactive) onKeyDown?.(event)
      }}
    />
  )
})
