import { cp, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { parse } from 'yaml'

/** 构建当前源码，返回发布清单中的组件条目，供宿主选择并启用。 */
export async function prepareBundle(ctx, root) {
  // 在临时包中构建当前源码，由 Loader 按发布清单解析公开入口。
  const pkg = join(root, 'package')
  await mkdir(pkg, { recursive: true })
  for (const path of ['package.json', 'cordis.patch.yml', 'tools', 'src'])
    await cp(path, join(pkg, path), { recursive: true })
  execFileSync(process.execPath, ['tools/build.ts'], { cwd: pkg })
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(pkg, 'package.json')).href })
  const patch = parse(await readFile(join(pkg, 'cordis.patch.yml'), 'utf8'))
  return patch.flatMap((entry) => entry.insert)
}
