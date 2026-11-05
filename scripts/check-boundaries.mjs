/** 静态导入边界检查：解析 JS/TS AST，覆盖导入、再导出、类型导入与动态导入。 */

import { parse } from '@babel/parser'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

/** 从仓库相对路径提取功能归属，根共享和装配层不属于业务组件。 */
const owner = (file) => /^src\/components\/([^/]+)\//.exec(file)?.[1]

/** 识别 host/client/shared 运行边界；与文件扩展名无关。 */
const layer = (file) => /(?:^|\/)(host|client|shared)\//.exec(file)?.[1]

/**
 * 解析单个源码文件并返回带行号的违规列表；解析失败也作为错误返回。
 * 不执行代码、不解析运行时拼接路径，因此动态 import 必须为固定字面量。
 */
export function checkImports(source, file) {
  const errors = []

  const report = (node, message) => errors.push(`${file}:${node.loc?.start.line ?? 1}: ${message}`)

  let ast
  try {
    ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  } catch (error) {
    return [`${file}:${error.loc?.line ?? 1}: 无法解析导入：${error.message}`]
  }

  /** 将相对路径规范化后检查组件归属和运行侧；包名自引用同样禁止以免绕过边界。 */
  function check(node, value) {
    if (/^dsh-rong-aio(?:$|[-/])/.test(value))
      report(node, '项目内部使用相对导入；不得通过包名绕过组件边界')
    if (!value.startsWith('.')) return
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), value))
    const from = owner(file)
    const to = owner(target)
    if (from && to && from !== to) report(node, '组件不得导入其他组件内部；通过公开服务契约协作')
    if (file.startsWith('src/shared/') && !target.startsWith('src/shared/'))
      report(node, '根 Shared 只能依赖跨组件共享的纯类型、协议和工具')
    if (from && target.startsWith('src/runtime/')) report(node, '组件实现不得依赖装配层')
    const side = layer(file)
    const targetSide = layer(target)
    if (
      (side === 'host' && targetSide === 'client') ||
      (side === 'client' && targetSide === 'host') ||
      (side === 'shared' && ['host', 'client'].includes(targetSide))
    )
      report(node, `${side} 不得导入 ${targetSide}；共用协议放在 shared`)
  }

  /** 遍历 AST 的代码节点，覆盖普通导入、再导出与 TypeScript 类型导入。 */
  function visit(node) {
    if (
      ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)
    ) {
      if (node.source) check(node, node.source.value)
    }
    if (node.type === 'TSImportType' || node.type === 'ImportExpression') {
      const value = node.argument ?? node.source
      if (value?.type === 'StringLiteral') check(node, value.value)
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Import') {
      if (node.arguments[0]?.type === 'StringLiteral') check(node, node.arguments[0].value)
      else report(node, '动态 import 必须使用可检查的固定路径')
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key))
        continue
      if (Array.isArray(value)) {
        for (const child of value) if (child?.type) visit(child)
      } else if (value?.type) visit(value)
    }
  }

  visit(ast)
  return errors
}

/** 递归收集源码文件，供命令行检查使用；目录读取失败直接使检查失败。 */
async function filesIn(directory) {
  const files = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      files.map((entry) => {
        const name = path.join(directory, entry.name)
        return entry.isDirectory() ? filesIn(name) : /\.[cm]?[jt]sx?$/.test(name) ? [name] : []
      }),
    )
  ).flat()
}

// CLI 入口与可复用检查函数分开：测试导入模块时不会自动扫描工作区。
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files =
    process.argv.length > 2
      ? process.argv.slice(2).map((file) => path.resolve(file))
      : await filesIn(path.join(root, 'src'))
  const errors = (
    await Promise.all(
      files.map(async (file) =>
        checkImports(
          await readFile(file, 'utf8'),
          path.relative(root, file).split(path.sep).join('/'),
        ),
      ),
    )
  ).flat()
  for (const error of errors) console.error(error)
  if (errors.length) process.exitCode = 1
  else console.log(`组件边界检查通过：${files.length} 个文件`)
}
