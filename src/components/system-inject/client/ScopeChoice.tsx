/** 模板保存位置控件：全局始终可选，只有入口绑定工程时才提供工程选项。 */

import { useEffect, useId, useState } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  Menu,
  PathLabel,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Scope } from '../shared/state.ts'

/** rc.5 未公开独立 Select；设置选项由官方 Menu 和 Button 组合，不实现另一套弹层或键盘逻辑。 */
export function ScopeChoice({
  value,
  workspace,
  disabled = false,
  path,
  onChange,
}: {
  /** 当前编辑草稿选择的保存范围。 */
  value: Scope

  /** 入口固定工作区；为空时不能新增工程选项。 */
  workspace: string

  /** 编辑既有文件或保存中时禁用范围修改。 */
  disabled?: boolean

  /** 当前文件或目标 prompts 目录，用官方 PathLabel 展示。 */
  path: string

  /** 将合法范围写回草稿，实际落盘由设置页保存。 */
  onChange: (value: Scope) => void
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const options = [
    { value: 'user' as const, label: '全局' },
    ...(workspace ? [{ value: 'workspace' as const, label: '当前项目' }] : []),
  ]
  const selected = value === 'user' ? '全局' : '当前项目'
  useEffect(() => setOpen(false), [disabled, value])
  return (
    <div className="rong-inject-field">
      <span id={id}>保存位置</span>
      <Menu
        open={open && !disabled}
        onClose={() => setOpen(false)}
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
          setOpen(false)
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
            aria-expanded={open && !disabled}
            title={selected}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
              if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                event.preventDefault()
                setOpen(true)
              }
            }}
          >
            <span className="rong-inject-choice-value" id={`${id}-value`}>
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
