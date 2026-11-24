import * as z from 'zod'
import { errorMessage } from '../../../shared/error.ts'
import { routeSchema } from './schemas.ts'
import { readVersion, writeVersion } from './files.ts'
import type { Paths } from './paths.ts'

const userConfigSchema = z
  .object({
    version: z.literal(1),
    whitelist: z.array(routeSchema).default([]),
  })
  .strict()

type UserConfig = z.infer<typeof userConfigSchema>

export interface ConfigFile {
  revision: string
  value: UserConfig
  error?: string
}

export class ConfigStore {
  private parsed?: ConfigFile

  constructor(private readonly paths: Paths) {}

  async read(): Promise<ConfigFile> {
    const path = this.paths.config()
    const empty: UserConfig = { version: 1, whitelist: [] }
    let revision = 'unreadable'

    try {
      const file = await readVersion(path)
      revision = file.revision
      if (file.text === undefined) return { revision, value: empty }

      if (this.parsed?.revision === revision) return structuredClone(this.parsed)

      const value = userConfigSchema.parse(JSON.parse(file.text) as unknown)
      this.parsed = { revision, value }
      return structuredClone(this.parsed)
    } catch (error) {
      return { revision, value: empty, error: `${path}：${errorMessage(error, String(error))}` }
    }
  }

  async save(value: UserConfig, expected: string): Promise<void> {
    const data = userConfigSchema.parse(value)
    await writeVersion(this.paths.config(), JSON.stringify(data, null, 2) + '\n', expected)
  }
}
