declare module '@babel/core' {
  export interface TransformOptions {
    filename?: string
    plugins?: unknown[]
    parserOpts?: { plugins?: string[] }
    sourceMaps?: boolean
    configFile?: boolean
    babelrc?: boolean
  }

  export interface TransformResult {
    code?: string | null
  }

  export function transformAsync(
    code: string,
    opts?: TransformOptions,
  ): Promise<TransformResult | null>
}

declare module 'babel-plugin-react-compiler' {
  const ReactCompilerPlugin: unknown
  export default ReactCompilerPlugin
}

declare module 'css-tree' {
  export interface CssPosition {
    line: number
    column: number
    offset: number
  }

  export interface CssLocation {
    source: string
    start: CssPosition
    end: CssPosition
  }

  export interface CssNodeList<T = CssNode> extends Iterable<T> {
    first: T | null
  }

  export interface CssNode {
    type: string
    loc?: CssLocation | null
    name?: string | CssNode
    value?: string | CssNode
    property?: string
    prelude?: CssNode | null
    children?: CssNodeList<CssNode>
    [key: string]: unknown
  }

  export interface ParseOptions {
    context?: string
    positions?: boolean
    parseCustomProperty?: boolean
    onParseError?: (error: Error & { line?: number }) => void
  }

  export interface WalkContext {
    rule?: CssNode | null
    atrule?: CssNode | null
  }

  export type WalkHandler =
    | ((node: CssNode) => void)
    | {
        enter?(this: WalkContext, node: CssNode): void
        leave?(node: CssNode): void
      }

  export function parse(text: string, options?: ParseOptions): CssNode
  export function generate(ast: CssNode): string
  export function walk(ast: CssNode, handler: WalkHandler): void

  export const ident: {
    decode(value: string): string
  }

  export const lexer: {
    matchType(typeName: string, value: string): { matched: unknown }
  }
}
