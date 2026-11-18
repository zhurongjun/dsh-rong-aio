# 工作约束

- Commit、Push 等行为需要用户批准，不许静默进行
- 保持组件及 Host、Client、Shared 的依赖边界。使用宿主公开接口，界面遵守 `scripts/ui-contract.json`。

# 目录约束

- 本文件不允许擅自更改，必须用户批准
- 工作过程中禁止留下任何文档，禁止擅自建立 `docs` 等目录
- 所用工作中的临时文件放在 `agent_temp/` 中，不得外泄到参与版本管理的目录中

# 构建流程

- 开发依赖固定版本，变更时同步更新 `pnpm-lock.yaml`。
- 完成改动后依次运行 `pnpm check`、`pnpm build`，再核对 Git 状态。不得禁用检查或忽略失败。
- 交付前必须通过 `pnpm lint` 校验代码规范与依赖边界。`pnpm check` 已包含此项校验。
- 打包使用 `pnpm pack --pack-destination agent_temp/packages` 并核对包内容。
