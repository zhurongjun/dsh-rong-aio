import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'rong-aio/session-removing'(id: SessionId): void | Promise<void>

    'rong-aio/session-claim'(id: SessionId): string | undefined
  }
}
