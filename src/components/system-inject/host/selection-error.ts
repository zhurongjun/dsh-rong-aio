import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { INJECT_SELECTION_ERROR } from '../shared/selection-error.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'rong-aio/inject-selection-rejected': { sessionId: string; noticeId: number }
  }
}

/** 明确拒绝表示没有提交选择，区别于结果未知的通信/写入错误。 */
export function selectionError(sessionId: string, noticeId: number, message: string) {
  return new RemoteError(INJECT_SELECTION_ERROR, message, { sessionId, noticeId })
}
