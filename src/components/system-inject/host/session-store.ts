import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import * as z from 'zod'
import { errorMessage } from '../../../shared/error.ts'
import type { FrozenSession, InjectState, ResolvedState } from '../shared/state.ts'
import type { RequestFailure } from '../shared/protocol.ts'
import { readVersion, withFileLocks, writeVersion } from './files.ts'
import { frozenSchema } from './schemas.ts'

export interface SessionMeta {
  id: string
  cwd?: string
  parent?: string
}

interface Candidate {
  resolved: ResolvedState
  revision?: string
}

export interface SessionEntry {
  meta: SessionMeta
  state: InjectState
  frozen?: FrozenSession
  candidate?: Candidate
  busy: boolean
  eligible: boolean
  error?: RequestFailure
  loadError?: string
}

const pendingSchema = z.object({ version: z.literal(1) }).strict()

type Parent = SessionEntry | (() => Promise<SessionEntry>)

export class SessionStore {
  readonly entries = new Map<string, SessionEntry>()
  private closed = false
  private readonly loading = new Map<string, Promise<SessionEntry>>()

  constructor(
    private readonly directory: (meta: SessionMeta) => string,
    private readonly flush: (id: string) => Promise<void>,
    private readonly hasHistory: (meta: SessionMeta) => Promise<boolean>,
  ) {}

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

  private async load(meta: SessionMeta, parent?: Parent): Promise<SessionEntry> {
    const entry: SessionEntry = {
      meta,
      state: { name: null },
      busy: false,
      eligible: false,
    }

    try {
      const file = await readVersion(join(this.directory(meta), 'system_inject.json'))
      if (file.text !== undefined) {
        entry.frozen = frozenSchema.parse(JSON.parse(file.text))
        entry.state = entry.frozen.state
      } else if (meta.parent) {
        const source = typeof parent === 'function' ? await parent() : parent
        if (!source?.frozen) throw new Error('父会话尚无冻结快照，不能推断子会话破甲状态')

        await this.persist(entry, {
          ...structuredClone(source.frozen),
          source: 'parent',
          inherited_from: meta.parent,
        })
      } else {
        const pending = await readVersion(join(this.directory(meta), 'system_inject.pending.json'))
        if (pending.text !== undefined) {
          pendingSchema.parse(JSON.parse(pending.text))
          entry.eligible = true
        } else if (await this.hasHistory(meta)) {
          await this.persist(entry, {
            version: 1,
            state: { name: null },
            source: 'none',
            frozen_at: new Date().toISOString(),
          })
        } else {
          entry.eligible = true
        }
      }
    } catch (error) {
      entry.loadError = `读取会话破甲快照失败：${errorMessage(error, String(error))}`
    }

    this.entries.set(meta.id, entry)
    return entry
  }

  async markPending(entry: SessionEntry): Promise<void> {
    if (!entry.eligible || entry.loadError) {
      throw new Error(entry.loadError ?? '此会话不能改选破甲词')
    }

    const directory = this.directory(entry.meta)
    await this.flush(entry.meta.id)

    await withFileLocks([directory], async () => {
      if ((await readVersion(join(directory, 'system_inject.json'))).text !== undefined) {
        throw new Error('会话已被其他进程冻结，请重新载入')
      }
      const path = join(directory, 'system_inject.pending.json')
      const file = await readVersion(path)
      if (file.text !== undefined) pendingSchema.parse(JSON.parse(file.text))
      else await writeVersion(path, JSON.stringify({ version: 1 }) + '\n', 'missing')
    })
  }

  get(id: string): SessionEntry {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('会话破甲状态尚未就绪')
    return entry
  }

  unavailable(id: string, error: unknown): SessionEntry {
    const entry: SessionEntry = {
      meta: { id },
      state: { name: null },
      busy: false,
      eligible: false,
      loadError: `无法恢复会话破甲状态：${errorMessage(error, String(error))}`,
    }
    this.entries.set(id, entry)
    return entry
  }

  async persist(entry: SessionEntry, frozen: FrozenSession): Promise<void> {
    const data = frozenSchema.parse(frozen)
    const directory = this.directory(entry.meta)

    await this.flush(entry.meta.id)
    await withFileLocks([directory], async () => {
      const path = join(directory, 'system_inject.json')
      if ((await readVersion(path)).text !== undefined) {
        throw new Error('会话已被其他进程冻结，请重新载入')
      }
      await writeVersion(path, JSON.stringify(data, null, 2) + '\n', 'missing')
    })

    entry.frozen = data
    entry.state = data.state
    entry.eligible = false

    await unlink(join(directory, 'system_inject.pending.json')).catch(() => {})
  }

  idle(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    entry.busy = false
    entry.candidate = undefined
  }

  private isEvictable(id: string, entry: SessionEntry): boolean {
    return (
      Boolean(entry.frozen) &&
      !entry.busy &&
      !entry.candidate &&
      !entry.error &&
      !this.loading.has(id)
    )
  }

  evictIfCold(id: string, maxEntries = 64): void {
    if (this.entries.size <= maxEntries) return

    const current = this.entries.get(id)
    if (current && this.isEvictable(id, current)) {
      this.entries.delete(id)
    }

    for (const [key, entry] of this.entries) {
      if (this.entries.size <= maxEntries) break
      if (this.isEvictable(key, entry)) this.entries.delete(key)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    await Promise.allSettled(this.loading.values())
    this.entries.clear()
    this.loading.clear()
  }
}
