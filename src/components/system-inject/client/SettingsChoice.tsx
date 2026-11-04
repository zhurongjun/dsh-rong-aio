import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'

interface Option {
  value: string
  label: string
  detail?: string
  disabled?: boolean
}

/** rc.5 未公开独立 Select；设置选项由官方 Menu 和 Button 组合，不实现另一套弹层或键盘逻辑。 */
export function SettingsChoice({
  label,
  value,
  options,
  disabled = false,
  hint,
  onChange,
}: {
  label: string
  value: string
  options: Option[]
  disabled?: boolean
  hint?: ReactNode
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const selected = options.find((option) => option.value === value)
  useEffect(() => setOpen(false), [disabled, value])
  return (
    <div className="rong-inject-field">
      <span id={id}>{label}</span>
      <Menu
        open={open && !disabled}
        onClose={() => setOpen(false)}
        portal
        className="rong-inject-choice"
        listClassName="rong-inject-choice-menu"
        selectedId={value}
        items={options.map((option) => ({
          id: option.value,
          disabled: option.disabled,
          label: (
            <span className="rong-inject-menu-label">
              <span className="rong-inject-menu-name" title={option.label}>
                {option.label}
              </span>
              {option.detail && (
                <small className="rong-inject-menu-detail" title={option.detail}>
                  {option.detail}
                </small>
              )}
            </span>
          ),
        }))}
        onSelect={(next) => {
          setOpen(false)
          if (next !== value) onChange(next)
        }}
        anchor={
          <Button
            variant="outline"
            size="sm"
            className="rong-inject-choice-trigger"
            disabled={disabled}
            aria-labelledby={`${id} ${id}-value`}
            aria-haspopup="menu"
            aria-expanded={open && !disabled}
            title={selected ? [selected.label, selected.detail].filter(Boolean).join(' · ') : value}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
              if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setOpen(true)
              }
            }}
          >
            <span className="rong-inject-choice-value" id={`${id}-value`}>
              {selected?.label ?? value}
            </span>
            <IconChevronDownOutlineRegular size={14} />
          </Button>
        }
      />
      {hint && <small>{hint}</small>}
    </div>
  )
}
