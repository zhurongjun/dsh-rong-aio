import { z } from 'zod'
import { routeSchema } from '../shared/protocol.ts'
import { message, readVersion, writeVersion } from './files.ts'
import type { Paths } from './paths.ts'

// 配置只维护用户白名单；不接受未定义字段，避免拼写错误被静默忽略。
const userConfigSchema = z
  .object({
    version: z.literal(1),
    whitelist: z.array(routeSchema).default([]),
  })
  .strict()
type UserConfig = z.infer<typeof userConfigSchema>
interface ConfigFile {
  revision: string
  value: UserConfig
  error?: string
}

/** 读取错误保留为诊断，不等同于未配置；只在文件确实不存在时使用默认值。 */
export class ConfigStore {
  private readonly paths: Paths
  private parsed?: ConfigFile
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
      if (file.text === undefined) return { revision, value: empty }
      // 每次仍读取文件并比对内容指纹；只复用解析结果，不让界面缓存影响请求校验。
      if (this.parsed?.revision === revision) return structuredClone(this.parsed)
      const raw: unknown = JSON.parse(file.text)
      const value = userConfigSchema.parse(raw)
      this.parsed = { revision, value }
      return structuredClone(this.parsed)
    } catch (error) {
      return { revision, value: empty, error: `${path}：${message(error)}` }
    }
  }
  async save(value: UserConfig, expected: string): Promise<void> {
    const data = userConfigSchema.parse(value)
    await writeVersion(this.paths.config(), JSON.stringify(data, null, 2) + '\n', expected)
  }
}
