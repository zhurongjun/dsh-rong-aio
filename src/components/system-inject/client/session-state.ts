/** 会话视图投影：只合并传输状态与操作通知，不重新解析破甲词或检查模型白名单。 */

import type { StateView } from '../shared/protocol.ts'

/** Toast 的展示投影；本地关闭不意味着修改会话破甲状态。 */
interface Notice {
  /** 当前 Toast 身份；读取错误按文本、宿主拒绝按递增通知 ID 区分。 */
  key: string

  /** 向用户展示的原因，保持宿主返回的语义。 */
  message: string

  /** 需要向宿主确认清理的拒绝 ID；通信错误没有此字段。 */
  failureId?: number
}

/** 仅组合传输状态和宿主结果；不在浏览器重做 resolve 或模型白名单判断。 */
export function sessionState(
  data: StateView | undefined,
  verified: boolean,
  saving: boolean,
  error?: string,
  dismissedNotice?: string,
) {
  const view = data?.session
  const notice: Notice | undefined = error
    ? { key: `read:${error}`, message: error }
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
