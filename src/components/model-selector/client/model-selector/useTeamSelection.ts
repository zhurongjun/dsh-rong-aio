/** Agent Team 交互事务：权威值只来自原生投影，本地仅保存提交中与关闭确认状态。 */

import { useEffect, useRef, useState } from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export interface TeamSelection {
  /** 原生 agentTeam 投影中的已保存值。 */
  enabled: boolean
  /** modelSelection 投影尚未就绪时不可修改。 */
  ready: boolean
  /** 原生 lastUsed 非空表示会话已使用模型，关闭前必须确认。 */
  needsConfirmation: boolean
  /** 绑定当前会话的原生 Remote；不调用选模或 Fast 接口。 */
  selectEnabled(enabled: boolean): Promise<RemoteResult<void>>
}

/** 失败保留确认状态并报告 Toast；卸载后的响应不影响其他会话。 */
export function useTeamSelection(
  team: TeamSelection | undefined,
  locked: boolean,
  dismiss: () => void,
  reportError: (message: string) => void,
) {
  const [pending, setPending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const inFlight = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!team) setConfirming(false)
  }, [team])

  /** Remote 成功只结束事务，显示仍等待宿主投影；同一时刻最多提交一次。 */
  const save = async (enabled: boolean) => {
    if (!team?.ready || locked || inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      const result = await team.selectEnabled(enabled)
      if (!result.ok) throw new Error(result.error.message)
      if (alive.current) setConfirming(false)
    } catch (error) {
      if (alive.current)
        reportError(
          `Agent Team 设置失败：${error instanceof Error ? error.message : String(error)}`,
        )
    } finally {
      inFlight.current = false
      if (alive.current) setPending(false)
    }
  }

  return {
    pending,
    confirming,
    /** 关闭已有请求的会话时先释放主菜单，再打开会话固定的官方 Modal。 */
    select(enabled: boolean) {
      if (!team?.ready || locked || inFlight.current || enabled === team.enabled) return
      if (!enabled && team.needsConfirmation) {
        dismiss()
        setConfirming(true)
      } else void save(enabled)
    },
    confirm: () => void save(false),
    cancel() {
      if (!inFlight.current) setConfirming(false)
    },
  }
}

export type TeamInteraction = ReturnType<typeof useTeamSelection>
