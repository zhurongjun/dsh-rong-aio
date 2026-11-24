import { transformAsync } from '@babel/core'
import ReactCompilerPlugin from 'babel-plugin-react-compiler'
import { build, transform } from 'esbuild'
import type { BuildOptions, Plugin } from 'esbuild'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PROVIDER_ICON_IDS } from '../src/shared/provider-icon.ts'
import { loadWorkspaceManifests } from './manifest.ts'

const { root: rootDir, manifest, components } = await loadWorkspaceManifests()
const output = path.join(rootDir, 'lib')

const declaration =
  "import type { Context } from '@deepseek-ai/cordis'\nexport declare const inject: string[]\nexport declare function apply(ctx: Context): Promise<void>\n"

const hostBuild: BuildOptions = {
  absWorkingDir: rootDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  banner: {
    js: "import { createRequire as __rongCreateRequire } from 'node:module'; const require = __rongCreateRequire(import.meta.url);",
  },
}

function readXmlAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const pattern = /([a-zA-Z0-9:-]+)\s*=\s*"([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1]] = match[2]
  }
  return attrs
}

function parseSvgIconAsset(raw: string, filePath: string) {
  const svgMatch = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/i.exec(raw)
  if (!svgMatch) throw new Error(`无效的 SVG 图标文件：${filePath}`)
  const rootAttrs = readXmlAttributes(svgMatch[1])
  if (!rootAttrs.viewBox) throw new Error(`SVG 缺少 viewBox：${filePath}`)

  const shapes: Array<Record<string, string>> = []
  const childPattern = /<(path|ellipse)\b([^>]*?)\/?>(?:<\/\1>)?/gi
  let childMatch: RegExpExecArray | null
  while ((childMatch = childPattern.exec(svgMatch[2])) !== null) {
    const tag = childMatch[1].toLowerCase()
    const attrs = readXmlAttributes(childMatch[2])
    if (tag === 'path' && attrs.d) {
      shapes.push({
        tag: 'path',
        d: attrs.d,
        ...(attrs['clip-rule'] ? { clipRule: attrs['clip-rule'] } : {}),
        ...(attrs['fill-opacity'] ? { fillOpacity: attrs['fill-opacity'] } : {}),
      })
    } else if (tag === 'ellipse' && attrs.cx && attrs.cy && attrs.rx && attrs.ry) {
      shapes.push({
        tag: 'ellipse',
        cx: attrs.cx,
        cy: attrs.cy,
        rx: attrs.rx,
        ry: attrs.ry,
      })
    }
  }
  if (!shapes.length) throw new Error(`SVG 缺少有效矢量图形：${filePath}`)

  return {
    viewBox: rootAttrs.viewBox,
    ...(rootAttrs['fill-rule'] ? { fillRule: rootAttrs['fill-rule'] } : {}),
    shapes,
  }
}

async function loadProviderIcons(iconsDir: string): Promise<string> {
  const files = (await readdir(iconsDir)).filter((name) => name.endsWith('.svg')).sort()
  const expected = [...PROVIDER_ICON_IDS].map((id) => `${id}.svg`).sort()
  if (files.length !== expected.length || files.some((file, index) => file !== expected[index])) {
    throw new Error('供应商图标目录与 PROVIDER_ICON_IDS 声明不一致')
  }
  const entries = await Promise.all(
    files.map(async (file) => {
      const filePath = path.join(iconsDir, file)
      const raw = await readFile(filePath, 'utf8')
      return [file.slice(0, -4), parseSvgIconAsset(raw, filePath)] as const
    }),
  )
  return JSON.stringify(Object.fromEntries(entries))
}

function createProviderIconsPlugin(serializedIcons: string): Plugin {
  return {
    name: 'provider-icons',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^virtual:provider-icons$/ }, (args) => ({
        path: args.path,
        namespace: 'provider-icons',
      }))
      pluginBuild.onLoad({ filter: /.*/, namespace: 'provider-icons' }, () => ({
        contents: serializedIcons,
        loader: 'json',
      }))
    },
  }
}

function createReactCompilerPlugin(sourceRoot: string): Plugin {
  return {
    name: 'react-compiler',
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        if (!args.path.startsWith(sourceRoot)) return undefined
        const raw = await readFile(args.path, 'utf8')
        const stripped = await transform(raw, {
          loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx',
          jsx: 'preserve',
          target: 'es2022',
          sourcefile: args.path,
        })
        const compiled = await transformAsync(stripped.code, {
          filename: args.path,
          plugins: [[ReactCompilerPlugin, { target: '18', panicThreshold: 'all_errors' }]],
          parserOpts: { plugins: ['jsx'] },
          sourceMaps: false,
          configFile: false,
          babelrc: false,
        })
        if (!compiled?.code) throw new Error(`React Compiler 未产出代码：${args.path}`)
        return { contents: compiled.code, loader: 'jsx' }
      })
    },
  }
}

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

await build({
  ...hostBuild,
  entryPoints: ['src/runtime/host/component.ts'],
  outfile: 'lib/runtime/host/component.js',
})

const sourceRoot = path.join(rootDir, 'src') + path.sep
const iconsDir = path.join(rootDir, 'src/client/providers/icons')
const serializedProviderIcons = await loadProviderIcons(iconsDir)

await cp(iconsDir, path.join(output, 'assets/providers'), {
  recursive: true,
})

for (const { id, source, manifest: component, hasHost, hasClient } of components) {
  const directory = path.join(output, 'components', id)
  await mkdir(directory, { recursive: true })

  if (hasHost) {
    await build({
      ...hostBuild,
      entryPoints: [`${source}/host/index.ts`],
      outfile: `${directory}/index.js`,
    })
  } else {
    await writeFile(
      path.join(directory, 'index.js'),
      'export const inject = []\nexport async function apply() {}\n',
    )
  }

  if (hasClient) {
    await build({
      absWorkingDir: rootDir,
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
      plugins: [
        createProviderIconsPlugin(serializedProviderIcons),
        createReactCompilerPlugin(sourceRoot),
      ],
      banner: {
        js: `window.__ModuleLoader__.load({id:${JSON.stringify(component.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
      },
      footer: { js: 'return module.exports;}});' },
    })
  }

  await writeFile(path.join(directory, 'package.json'), `${JSON.stringify(component, null, 2)}\n`)
  await writeFile(path.join(directory, 'index.d.ts'), declaration)
  await cp(path.join(rootDir, source, 'locale'), path.join(directory, 'locale'), {
    recursive: true,
  })

  await writeFile(
    path.join(output, `${id}.js`),
    `import { defineComponent } from './runtime/host/component.js'\n` +
      `export const { inject, apply } = defineComponent(new URL('./components/${id}/index.js', import.meta.url))\n`,
  )
  await writeFile(path.join(output, `${id}.d.ts`), declaration)
}

console.log(
  `构建产物：${manifest.name}@${manifest.version}（${components.map((c) => c.id).join(', ')}）-> lib/`,
)
