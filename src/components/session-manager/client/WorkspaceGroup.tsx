import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Checkbox,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconTriangleRightFillRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'

interface Props {
  title: string
  path?: string
  count: number
  selectedCount: number
  disabled: boolean
  onSelect: (checked: boolean) => void
  children: ReactNode
}

export function WorkspaceGroup({
  title,
  path,
  count,
  selectedCount,
  disabled,
  onSelect,
  children,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  const checkbox = useRef<HTMLSpanElement>(null)
  const mixed = selectedCount > 0 && selectedCount < count
  useLayoutEffect(() => {
    // DSH 的 Checkbox 提供原生 input；半选状态只能通过 DOM 属性设置。
    const input = checkbox.current?.querySelector('input')
    if (input) input.indeterminate = mixed
  }, [mixed])
  const Folder = expanded ? IconFolderOpenRegular : IconFolderCloseRegular

  return (
    <div className="rong-session-group">
      <div className="rong-session-group-header">
        <button
          type="button"
          className="rong-session-disclosure"
          title={path}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(!expanded)}
        >
          <Folder size={16} className="rong-session-folder" />
          <IconTriangleRightFillRegular size={16} className="rong-session-arrow" />
          <span>{title}</span>
        </button>
        <span ref={checkbox} className="rong-session-group-check">
          <Checkbox
            label={'全选工作区「' + title + '」'}
            title={'全选工作区「' + title + '」'}
            checked={selectedCount === count}
            disabled={disabled}
            onChange={onSelect}
          />
        </span>
      </div>
      <ul hidden={!expanded} id={listId} aria-label={title}>
        {children}
      </ul>
    </div>
  )
}
