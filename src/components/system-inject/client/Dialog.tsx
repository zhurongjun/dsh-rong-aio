/** 组件内的紧凑内容布局；模态表面、焦点管理及层级使用 DSH 官方实现。 */

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
  /** 由调用方控制可见性，官方 Modal 负责开合及焦点。 */
  open: boolean

  /** 关闭请求回调；是否保留编辑草稿由调用方决定。 */
  onClose: () => void

  /** 可访问性标题与可见标题统一使用的文本。 */
  title: string

  /** 主要阅读/编辑内容，放在可滚动主体中。 */
  children: ReactNode

  /** 底部确认操作，省略时不占用空白区域。 */
  actions?: ReactNode

  /** 标题旁操作，例如复制快照正文。 */
  headerActions?: ReactNode

  /** 短提示或长正文的布局密度，材质仍由官方 Modal 提供。 */
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
