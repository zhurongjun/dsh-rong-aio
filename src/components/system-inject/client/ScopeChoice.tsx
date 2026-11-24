import { useId, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  Menu,
  PathLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Scope } from '../shared/state.ts'

export function ScopeChoice({
  value,
  workspace,
  disabled = false,
  path,
  onChange,
}: {
  value: Scope
  workspace: string
  disabled?: boolean
  path: string
  onChange: (value: Scope) => void
}) {
  const [openFor, setOpenFor] = useState<Scope | null>(null)
  const id = useId()
  const options = [
    { value: 'user' as const, label: '全局' },
    ...(workspace ? [{ value: 'workspace' as const, label: '当前项目' }] : []),
  ]
  const selected = value === 'user' ? '全局' : '当前项目'
  const isOpen = !disabled && openFor === value

  return (
    <div className="rong-inject-field">
      <span id={id}>保存位置</span>
      <Menu
        open={isOpen}
        onClose={() => setOpenFor(null)}
        portal
        className="rong-inject-choice"
        listClassName="rong-inject-choice-menu"
        selectedId={value}
        items={options.map((option) => ({
          id: option.value,
          label: (
            <span className="rong-inject-menu-label">
              <span className="rong-inject-menu-name" title={option.label}>
                {option.label}
              </span>
            </span>
          ),
        }))}
        onSelect={(next) => {
          setOpenFor(null)
          const option = options.find((item) => item.value === next)
          if (option && next !== value) onChange(option.value)
        }}
        anchor={
          <Button
            variant="outline"
            size="sm"
            className="rong-inject-choice-trigger"
            disabled={disabled}
            aria-labelledby={`${id} ${id}-value`}
            aria-haspopup="menu"
            aria-expanded={isOpen}
            title={selected}
            onClick={() => setOpenFor(isOpen ? null : value)}
            onKeyDown={(event) => {
              if (!isOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setOpenFor(value)
              }
            }}
          >
            <span className="rong-inject-choice-value rong-truncate" id={`${id}-value`}>
              {selected}
            </span>
            <IconChevronDownOutlineRegular size={14} />
          </Button>
        }
      />
      <small>
        <PathLabel path={path} />
      </small>
    </div>
  )
}
