import type { StateView } from '../shared/protocol.ts'

interface Notice {
  key: string
  message: string
  failureId?: number
}

export function sessionState(
  data: StateView | undefined,
  verified: boolean,
  saving: boolean,
  error?: string,
  errorId = 0,
  dismissedNotice?: string,
) {
  const view = data?.session
  const notice: Notice | undefined = error
    ? { key: `read:${errorId}`, message: error }
    : view?.error
      ? {
          key: `request:${view.error.id}`,
          failureId: view.error.id,
          message: view.error.message,
        }
      : undefined

  return {
    block: saving ? '正在保存破甲选择…' : !verified ? (error ?? '正在读取破甲状态…') : undefined,
    active: verified && view?.resolved.status === 'on',
    notice: notice?.key === dismissedNotice ? undefined : notice,
  }
}
