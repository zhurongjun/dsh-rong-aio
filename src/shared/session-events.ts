import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** 在会话写锁内清理各组件自己持有的状态。失败时保留主日志以便重试。 */
    'rong-aio/session-removing'(id: SessionId): void | Promise<void>
  }
}
