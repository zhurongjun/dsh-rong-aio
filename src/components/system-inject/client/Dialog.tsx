import type { ReactNode } from 'react'
import { Button, IconCloseOutlineRegular, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

/** 破甲模式的紧凑内容框；遮罩、焦点、Escape 与嵌套层级仍由官方 Modal 管理。 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  headerActions,
  size = 'notice',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  actions?: ReactNode
  headerActions?: ReactNode
  size?: 'notice' | 'content'
}) {
  return (
    <Modal
      headless
      open={open}
      onClose={onClose}
      title={title}
      className={`rong-inject-dialog rong-inject-dialog-size-${size}`}
    >
      <header className="rong-inject-dialog-header">
        <h2>{title}</h2>
        {headerActions}
        <Button
          size="sm"
          className="rong-inject-dialog-close"
          icon={<IconCloseOutlineRegular size={14} />}
          aria-label="关闭"
          onClick={onClose}
        />
      </header>
      <div className="rong-inject-dialog-content">{children}</div>
      {actions && <footer className="rong-inject-dialog-actions">{actions}</footer>}
    </Modal>
  )
}
