import { loadWorkspaceManifests } from '../manifest.ts'
import { runBoundariesCheck } from './boundaries.ts'
import { runUiContractCheck } from './ui-contract.ts'

const errors: string[] = []
let componentCount = 0

try {
  componentCount = (await loadWorkspaceManifests()).components.length
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error))
}

const [boundaries, uiContract] = await Promise.all([runBoundariesCheck(), runUiContractCheck()])
errors.push(...boundaries.errors, ...uiContract.errors)

for (const error of errors) console.error(error)

if (errors.length) {
  process.exitCode = 1
} else {
  console.log(
    `契约检查：${componentCount} 个组件，边界 ${boundaries.fileCount} 个文件，UI ${uiContract.fileCount} 个文件（DSH ${uiContract.version}）`,
  )
}
