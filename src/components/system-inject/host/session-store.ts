/** 会话状态存储：临时选择驻留内存，首次放行资格和冻结正文写入原生会话伴随文件。 */

import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { z } from 'zod'
import {
  frozenSchema,
  type FrozenSession,
  type InjectState,
  type ResolvedState,
} from '../shared/state.ts'
import type { RequestFailure } from '../shared/protocol.ts'
import { message, readVersion, withFileLocks, writeVersion } from './files.ts'

/** 定位会话的最小原生元数据，不复制完整 DSH 会话对象。 */
export interface SessionMeta {
  /** 原生 session ID，也是宿主内存表的键。 */
  id: string

  /** 原生会话工作区；undefined 表示原生无工作区分区。 */
  cwd?: string

  /** 首次继承时的父会话 ID；自己的快照存在后不再依赖父会话。 */
  parent?: string
}

/** 一次尚未放行请求的内存候选；它不是冻结成功的证明。 */
interface Candidate {
  /** 捕获瞬间的完整解析结果与正文副本。 */
  resolved: ResolvedState

  /** 开启候选的文件组合指纹；关闭候选没有模板依赖。 */
  revision?: string
}

/** 单会话权威状态。资格、恢复错误、候选与冻结分别表示不同阶段，不能互相替代。 */
export interface SessionEntry {
  /** 定位原生会话目录及继承关系的元数据。 */
  meta: SessionMeta

  /** 未冻结时是显式选择；冻结后与冻结快照中的 state 一致。 */
  state: InjectState

  /** 持久化成功的不可变正文与来源，优先于其他状态。 */
  frozen?: FrozenSession

  /** 本次装配持有的候选，直到分发冻结或请求结束。 */
  candidate?: Candidate

  /** 请求准备占用；用于拒绝并发改选。 */
  busy: boolean

  /** 是否允许首次选词，仅空会话或有效 pending 标记可为 true。 */
  eligible: boolean

  /** 最近一次未确认的操作/请求失败，与破甲状态本身分离。 */
  error?: RequestFailure

  /** 恢复失败诊断；保持只读，不退回可编辑状态。 */
  loadError?: string
}

const pendingSchema = z.object({ version: z.literal(1) }).strict()

/** 父状态可以按需延迟恢复；读取到本会话快照时不会执行回调。 */
type Parent = SessionEntry | (() => Promise<SessionEntry>)

/**
 * 管理单宿主的会话恢复、首次请求资格和冻结快照。
 *
 * 临时选择只存在内存；pending 只证明首次请求尚未放行，不保存选词。
 * 恢复顺序为自身快照、首次父级继承、pending、原生历史，绝不重新解析冻结正文。
 * 单个会话的损坏保留为 loadError；关闭组件仅清理内存，不迁移或删除用户文件。
 */
export class SessionStore {
  /** 当前宿主已初始化的会话状态，按 ID 隔离。 */
  readonly entries = new Map<string, SessionEntry>()

  /** 阻止关闭后的恢复任务进入存储。 */
  private closed = false

  /** 同一 ID 的并发初始化共享 Promise，防止重复继承和写盘。 */
  private readonly loading = new Map<string, Promise<SessionEntry>>()

  /** 根据原生元数据计算伴随文件目录，失败向上传递。 */
  private readonly directory: (meta: SessionMeta) => string

  /** 确保原生会话存在并持久化，再写组件伴随文件。 */
  private readonly flush: (id: string) => Promise<void>

  /** 只判断是否已有请求/消息历史，不组装系统提示词。 */
  private readonly hasHistory: (meta: SessionMeta) => Promise<boolean>

  /** 注入目录、原生 flush 和历史检查；不在构造时访问任何会话。 */
  constructor(
    directory: (meta: SessionMeta) => string,
    flush: (id: string) => Promise<void>,
    hasHistory: (meta: SessionMeta) => Promise<boolean>,
  ) {
    this.directory = directory
    this.flush = flush
    this.hasHistory = hasHistory
  }

  /** 按会话 ID 去重恢复；同一宿主重复调用返回同一 entry，恢复错误保留在 entry 内。 */
  async initialize(meta: SessionMeta, parent?: Parent): Promise<SessionEntry> {
    if (this.closed) throw new Error('会话存储已关闭')
    const existing = this.entries.get(meta.id)
    if (existing) return existing
    const pending = this.loading.get(meta.id)
    if (pending) return pending
    const task = this.load(meta, parent)
    this.loading.set(meta.id, task)
    try {
      return await task
    } finally {
      this.loading.delete(meta.id)
    }
  }

  /** 按快照、父会话、pending、原生历史的顺序恢复。单个会话错误仅污染该 entry。 */
  private async load(meta: SessionMeta, parent?: Parent): Promise<SessionEntry> {
    const entry: SessionEntry = {
      meta,
      state: { name: null },
      busy: false,
      eligible: false,
    }
    try {
      // 第一优先级是本会话独立快照，不要求父会话或模板库仍然可用。
      const file = await readVersion(join(this.directory(meta), 'system_inject.json'))
      if (file.text !== undefined) {
        entry.frozen = frozenSchema.parse(JSON.parse(file.text))
        entry.state = entry.frozen.state
      } else if (meta.parent) {
        // 上方分支优先读取自己的快照；仅首次继承才访问父会话。
        const source = typeof parent === 'function' ? await parent() : parent
        if (!source?.frozen) throw new Error('父会话尚无冻结快照，不能推断子会话破甲状态')
        const inherited: FrozenSession = {
          ...structuredClone(source.frozen),
          source: 'parent',
          inherited_from: meta.parent,
        }

        // 子会话必须保留自己的独立副本，不能在父会话删除后丢失正文。
        await this.persist(entry, inherited)
      } else {
        const pending = await readVersion(join(this.directory(meta), 'system_inject.pending.json'))
        if (pending.text !== undefined) {
          pendingSchema.parse(JSON.parse(pending.text))
          entry.eligible = true
        } else if (await this.hasHistory(meta)) {
          // 没有本组件记录的既有会话绝不补注入，也不开放选择。
          await this.persist(entry, {
            version: 1,
            state: { name: null },
            source: 'none',
            frozen_at: new Date().toISOString(),
          })
        } else entry.eligible = true
      }
    } catch (error) {
      entry.loadError = `读取会话破甲快照失败：${message(error)}`
    }
    this.entries.set(meta.id, entry)
    return entry
  }

  /** 在首个请求捕获前记录资格；只记事实，不把临时选择或正文写入磁盘。 */
  async markPending(entry: SessionEntry): Promise<void> {
    if (!entry.eligible || entry.loadError)
      throw new Error(entry.loadError ?? '此会话不能改选破甲词')
    const directory = this.directory(entry.meta)
    await this.flush(entry.meta.id)
    await withFileLocks([directory], async () => {
      if ((await readVersion(join(directory, 'system_inject.json'))).text !== undefined)
        throw new Error('会话已被其他进程冻结，请重新载入')
      const path = join(directory, 'system_inject.pending.json')
      const file = await readVersion(path)
      if (file.text !== undefined) pendingSchema.parse(JSON.parse(file.text))
      else await writeVersion(path, JSON.stringify({ version: 1 }) + '\n', 'missing')
    })
  }

  /** 取得已初始化状态；调用顺序错误直接抛出，不隐式创建可编辑会话。 */
  get(id: string): SessionEntry {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('会话破甲状态尚未就绪')
    return entry
  }

  /** 元数据定位失败也限定在当前会话，不能让一个坏会话拖垮整个组件。 */
  unavailable(id: string, error: unknown): SessionEntry {
    const entry: SessionEntry = {
      meta: { id },
      state: { name: null },
      busy: false,
      eligible: false,
      loadError: `无法恢复会话破甲状态：${message(error)}`,
    }
    this.entries.set(id, entry)
    return entry
  }

  /**
   * 校验快照后原子写入；原生 flush 或并发冻结冲突会抛错。
   * 写盘成功才更新内存并撤销编辑资格；pending 清理失败不撤销已有快照。
   */
  async persist(entry: SessionEntry, frozen: FrozenSession): Promise<void> {
    const data = frozenSchema.parse(frozen)
    const directory = this.directory(entry.meta)

    // 原生 flush 负责会话日志的持久化，组件只写伴随文件。
    await this.flush(entry.meta.id)
    await withFileLocks([directory], async () => {
      const path = join(directory, 'system_inject.json')
      if ((await readVersion(path)).text !== undefined)
        throw new Error('会话已被其他进程冻结，请重新载入')
      await writeVersion(path, JSON.stringify(data, null, 2) + '\n', 'missing')
    })
    entry.frozen = data
    entry.state = data.state
    entry.eligible = false

    // 冻结文件是权威结果。清理失败留下的资格标记在读取时被它遮蔽，不能撤销冻结。
    await unlink(join(directory, 'system_inject.pending.json')).catch(() => {})
  }

  /** 释放本次请求占用和候选；保留已冻结快照与待确认通知。 */
  idle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.busy = false
    entry.candidate = undefined
  }

  /** 阻止新增初始化，等待正在恢复的会话结束，再清空内存；保留所有用户文件。 */
  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled(this.loading.values())
    this.entries.clear()
    this.loading.clear()
  }
}
