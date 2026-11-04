import { z } from 'zod'
import { routeSchema } from '../shared/protocol.ts'
import { message, readVersion, writeVersion } from './files.ts'
import type { Paths } from './paths.ts'

// 配置只维护用户白名单。Zod 剥离未消费字段，历史 state 不进入解析结果或后续保存。
export const userConfigSchema = z.object({
  version: z.literal(1),
  whitelist: z.array(routeSchema).default([]),
})
export type UserConfig = z.infer<typeof userConfigSchema>
export interface ConfigFile {
  path: string
  revision: string
  value: UserConfig
  error?: string
}

/** 读取错误保留为诊断，不等同于未配置；只在文件确实不存在时使用默认值。 */
export class ConfigStore {
  private readonly paths: Paths
  private readonly parsed = new Map<string, ConfigFile>()
  constructor(paths: Paths) {
    this.paths = paths
  }
  async read(): Promise<ConfigFile> {
    const path = this.paths.config()
    const empty: UserConfig = { version: 1, whitelist: [] }
    let revision = 'unreadable'
    try {
      const file = await readVersion(path)
      revision = file.revision
      if (file.text === undefined) return { path, revision, value: empty }
      // 每次仍读取文件并比对内容指纹；只复用解析结果，不让界面缓存影响请求校验。
      const cached = this.parsed.get(path)
      if (cached?.revision === revision) return structuredClone(cached)
      const raw: unknown = JSON.parse(file.text)
      const value = userConfigSchema.parse(raw)
      const result = { path, revision, value }
      if (this.parsed.size >= 256) this.parsed.clear()
      this.parsed.set(path, result)
      return structuredClone(result)
    } catch (error) {
      return { path, revision, value: empty, error: `${path}：${message(error)}` }
    }
  }
  async save(value: UserConfig, expected: string): Promise<void> {
    const data = userConfigSchema.parse(value)
    await writeVersion(this.paths.config(), JSON.stringify(data, null, 2) + '\n', expected)
  }
}
