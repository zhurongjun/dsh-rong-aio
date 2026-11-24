import { forwardRef, type ButtonHTMLAttributes } from 'react'

interface Props extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'aria-disabled' | 'aria-busy'
> {
  busy?: boolean
  inactive?: boolean
}

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
        if (!disabled && !busy && !inactive) onKeyDown?.(event)
      }}
    />
  )
})
