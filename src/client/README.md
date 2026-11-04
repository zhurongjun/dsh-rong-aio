# Client

浏览器侧实现。`index.ts` 通过 DSH 公开插槽挂载 `model-selector/`，复用模型目录，不导入 Host 或 Node。组件卸载清理事件、动画和观察器；插件停用清理样式与插槽。

## 状态与渲染边界

- 每个选择器实例建立独立的 Zustand + Immer store，会话切换时重建。`selector-store.ts` 管理弹层、搜索、预览和保存状态，组件按字段订阅；不订阅整个 store。
- `speed-store.ts` 管理已确认的 Fast 状态与异步请求。首次挂载读取，弹层关闭后保留提示；切换会话、provider 或 model 时取消旧请求，过期结果不能覆盖当前状态。请求控制器留在闭包中，卸载时释放。
- DSH 模型目录是持久化选择的唯一来源，通过稳定的 `useSyncExternalStore` 订阅读取，不复制到 Immer，不冻结或改写宿主快照。模型过滤、列表偏移和强度派生值按输入缓存。
- 输入框、强度标题、模型列表、Fast 菜单分别消费所需状态。仅组件内部使用的 DOM 位置、拖动手势和系统减弱动画偏好留在组件中；位置相同不触发更新。
- `useSliderMotion.ts` 的 RAF 仅更新动画拥有的样式、粒子容器子节点与圆点属性，不逐帧触发 React 或 Immer。React 管理其余结构及可访问性语义；不得同时用 JSX 管理粒子容器子节点或 `data-passed`、`--rong-position`。运动曲线与粒子参数继续复用 Shared 的固定上游实现。
- Zustand、Immer 与 Zod 随构建内嵌，React 和 DSH 模块由宿主提供；安装不需要下载这些库或执行生命周期脚本。
