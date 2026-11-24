/** 通用危险与常规确认弹窗：统一基于宿主 Modal 与 Button，保证取消按钮默认获得初始焦点。 */

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

export interface ConfirmModalProps {
  open: boolean
  title: string
  description?: string
  tone?: 'warning'
  closeLabel?: string
  cancelLabel?: string
  confirmLabel: string
  confirmIcon?: ReactNode
  destructive?: boolean
  busy?: boolean
  confirmDisabled?: boolean
  onCancel: () => void
  onConfirm: () => void
  children?: ReactNode
}

/** 受管确认弹窗：忙碌期间锁定关闭与双端按钮，常规确认高亮主操作，危险操作使用警示描边按钮。 */
export function ConfirmModal({
  open,
  title,
  description,
  tone,
  closeLabel = '关闭',
  cancelLabel = '取消',
  confirmLabel,
  confirmIcon,
  destructive = false,
  busy = false,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      tone={tone}
      closeLabel={closeLabel}
      description={description}
      footer={
        <>
          <Button variant="outline" data-modal-autofocus disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'outline' : 'primary'}
            className={clsx(destructive && 'rong-danger-button rong-danger-confirm')}
            icon={confirmIcon}
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
