# Host

`index.ts` 注册经过 DSH 连接认证的速度设置接口，用 `storageDomain` 保存每个会话、provider、model 的选择，并接入公开 `llm/stream` 瀑布。

`speed-transport.ts` 是 rc.5 的 HTTP 兼容层：用 AsyncLocalStorage 隔离请求，只向匹配的 OpenAI / Anthropic JSON 请求添加速度参数。停用时恢复 fetch；不导入 Client，不改写提示词、工具或会话日志。型号规则在 Shared 中维护，协议范围和限制见 `docs/model-selector.md`。
