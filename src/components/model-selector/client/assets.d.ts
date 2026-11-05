/** 构建时将 CSS 作为文本导入；仅声明类型，运行时样式由组件入口挂载和释放。 */

declare module '*.css' {
  const css: string
  export default css
}
