# Client

浏览器侧实现。`index.ts` 通过 DSH 公开插槽挂载 `model-selector/`，复用模型目录，不导入 Host 或 Node。组件卸载清理事件、动画和观察器；插件停用清理样式与插槽。
