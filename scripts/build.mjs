/** 统一构建入口：发现组件清单，生成独立 host/client 产物、子路径入口及声明文件。 */

import { build } from 'esbuild'
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

/** 相对工程根读取 JSON；坏清单立即终止构建，不生成半合法入口。 */
const json = async (name) => JSON.parse(await readFile(path.join(root, name), 'utf8'))

const manifest = await json('package.json')

const output = path.join(root, 'lib')

/** 各宿主入口统一导出的最小 Cordis 类型契约。 */
const declaration =
  "import type { Context } from '@deepseek-ai/cordis'\nexport declare const inject: string[]\nexport declare function apply(ctx: Context): Promise<void>\n"

/** 判断组件是否提供实际宿主入口；纯 UI 组件由构建生成锚点。 */
const exists = async (name) =>
  access(path.join(root, name)).then(
    () => true,
    () => false,
  )

/** 宿主构建基线；框架由 DSH 提供，业务依赖内嵌到对应组件。 */
const hostBuild = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',

  // Cordis 与 Loader 必须共享宿主实例，不能内嵌另一份框架。
  external: ['@deepseek-ai/*'],

  // YAML 的 Node 分支含 CJS 内置模块引用；ESM 宿主包提供原生 require。
  banner: {
    js: "import { createRequire as __rongCreateRequire } from 'node:module'; const require = __rongCreateRequire(import.meta.url);",
  },
}

// 第一阶段：清空生成目录并构建唯一装配器，避免删除组件后残留旧产物。
await rm(output, { recursive: true, force: true })

await mkdir(output, { recursive: true })

await build({
  ...hostBuild,
  entryPoints: ['src/runtime/host/component.ts'],
  outfile: 'lib/runtime/host/component.js',
})

// 第二阶段：按目录发现组件并验证清单，再分别生成运行产物和元信息。
const components = await readdir(path.join(root, 'src/components'), { withFileTypes: true })

for (const entry of components.sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory()) continue
  const id = entry.name
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`非法组件目录名：${id}`)
  const source = `src/components/${id}`
  const component = await json(`${source}/package.json`)
  if (component.name !== `${manifest.name}-${id}` || component.type !== 'module')
    throw new Error(`${id} 必须声明唯一的 ESM 组件身份 ${manifest.name}-${id}`)
  if (manifest.exports[`./${id}`]?.default !== `./lib/${id}.js`)
    throw new Error(`根包缺少组件导出 ./${id}`)
  if (manifest.exports[`./${id}/locale/*.json`] !== `./lib/components/${id}/locale/*.json`)
    throw new Error(`根包缺少组件 locale 导出 ./${id}/locale/*.json`)
  if (['dependencies', 'devDependencies', 'scripts'].some((key) => component[key]))
    throw new Error(`${id} 的依赖和脚本必须统一放在根包`)
  const directory = path.join(output, 'components', id)
  await mkdir(directory, { recursive: true })
  const hasHost = await exists(`${source}/host/index.ts`)
  const hasClient = !!component.dsh?.client
  if (!hasHost && !hasClient) throw new Error(`${id} 没有运行入口`)

  // 宿主分支：真实入口直接打包，纯 UI 组件只生成 Loader 所需空锚点。
  if (hasHost) {
    await build({
      ...hostBuild,
      entryPoints: [`${source}/host/index.ts`],
      outfile: `${directory}/index.js`,
    })
  } else {
    // 纯 UI 组件仍需要可被 Loader 发现的宿主锚点。
    await writeFile(
      path.join(directory, 'index.js'),
      'export const inject = []\nexport async function apply() {}\n',
    )
  }

  // 客户端分支：使用 DSH 模块工厂，共享宿主 React 与公开客户端模块。
  if (hasClient) {
    if (component.exports['./client'] !== './client.js')
      throw new Error(`${id} 的 ./client 必须指向 ./client.js`)

    // rc.5 使用模块工厂；每个组件的 factory ID 与内部清单完全一致。
    await build({
      absWorkingDir: root,
      entryPoints: [`${source}/client/index.ts`],
      outfile: `${directory}/client.js`,
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      target: 'es2022',
      jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
      external: ['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/*'],
      loader: { '.css': 'text' },
      banner: {
        js: `window.__ModuleLoader__.load({id:${JSON.stringify(component.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
      },
      footer: { js: 'return module.exports;}});' },
    })
  }

  // 分发清单、声明与 locale；文件 URL 与客户端工厂身份在同一目录闭合。
  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(component, null, 2)}\n`)
  await writeFile(path.join(directory, 'index.d.ts'), declaration)
  await cp(path.join(root, source, 'locale'), path.join(directory, 'locale'), { recursive: true })

  // 子路径供原生管理页读取元信息；运行时以 file URL 挂载带独立清单的实现。
  await writeFile(
    path.join(output, `${id}.js`),
    `import { defineComponent } from './runtime/host/component.js'\n` +
      `export const { inject, apply } = defineComponent(new URL('./components/${id}/index.js', import.meta.url))\n`,
  )
  await writeFile(path.join(output, `${id}.d.ts`), declaration)
}
