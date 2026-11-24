import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 在会话写锁内清理各组件自己持有的状态。失败时保留主日志以便重试。 */
    'rong-aio/session-removing'(id: SessionId): void | Promise<void>

    /** 声明某个私有会话由特定组件独占管理；返回拒绝文案即隐藏并禁止通用会话管理器操作。 */
    'rong-aio/session-claim'(id: SessionId): string | undefined
  }
}
