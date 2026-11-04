# 跨组件共享

这里只放确实被多个组件使用的纯类型、服务契约和工具。当前尚无跨组件共享实现；模型选择和 Fast 规则属于 `components/model-selector/shared/`。

不得依赖组件内部、Host、Client、Node 或 DOM。组件之间需要协作时，在此定义公开契约，运行时通过 DSH 服务通信，不相互导入内部实现。
