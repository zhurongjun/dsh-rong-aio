declare module '*.css' {
  const css: string
  export default css
}

declare module 'virtual:provider-icons' {
  const icons: Readonly<
    Record<
      string,
      {
        readonly viewBox: string
        readonly fillRule?: 'nonzero' | 'evenodd' | 'inherit'
        readonly shapes: ReadonlyArray<
          | {
              readonly tag: 'path'
              readonly d: string
              readonly clipRule?: 'nonzero' | 'evenodd' | 'inherit'
              readonly fillOpacity?: string
            }
          | {
              readonly tag: 'ellipse'
              readonly cx: string
              readonly cy: string
              readonly rx: string
              readonly ry: string
            }
        >
      }
    >
  >
  export default icons
}
