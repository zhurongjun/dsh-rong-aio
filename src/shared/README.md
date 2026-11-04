# 跨组件共享

这里只放确实被多个组件使用的纯类型、服务契约和工具，目前没有需要共享的运行时代码。模型选择和 Fast 规则属于 `components/model-selector/shared/`；破甲校验及其错误协议属于 `components/system-inject/shared/`，两个组件不识别对方的业务状态或错误码。

不得依赖组件内部、Host、Client、Node 或 DOM。组件之间需要协作时，在此定义公开契约，运行时通过 DSH 服务通信，不相互导入内部实现。
