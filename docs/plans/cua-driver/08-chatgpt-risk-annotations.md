# Feature 08 — ChatGPT 原生风险提示集成

## 目标
- Desktop Commander 与 Cua 工具统一应用准确的风险注解，以便 ChatGPT 网页端可依据自身设置选择自动执行或提示确认。
- 只读、可能修改、可删除、外部网络等提示均基于工具实际能力；复合工具不能因为某个安全参数被简单标成只读。
- 风险标注仅为 MCP hints；不声称可以控制 ChatGPT 的原生确认弹窗。
- Cua standard、Windows/UAC 权限不被覆盖。
- 单独由 Broker 强制设备权限策略：full（默认）、read_only、custom。用户未修改时不破坏旧工具调用。

## 实现任务
1. 建立服务端受信任的工具风险分类器，覆盖固定 Desktop Commander 工具和 Cua 工具；其他工具保守处理。
2. 在工具 catalog 生成时为所有工具提供 readOnlyHint / destructiveHint / openWorldHint / idempotentHint。
3. SQLite 存储按 owner + device 的权限选择，Broker 在下发工具前拦截。
4. 暴露 get_device_permissions / set_device_permissions MCP 管理工具；允许通过 ChatGPT 网页使用，并限制账号所有权。
5. 提供 ChatGPT 网页端的 MCP Apps 设备权限卡片，预设「全部允许／仅查看／自定义」，工具按来源分组并持久化。
6. 自动化测试涵盖默认全开、阻止危险工具、跨账号隔离、持久化、未知工具、新设备、风险注解正确性、完整 Broker 执行路径。

## 限制和放行准则
- 默认全允许仅指 Desktop Bridge 不加额外拒绝；不意味着自动绕过 ChatGPT、Cua 与 Windows 系统权限。
- 不将危险系统命令“自研检测”为 100% 安全。start_process / write_file 等统统按可能破坏处理。
- 网页实际展示需要部署并在 chatgpt.com 重新刷新插件工具目录后手动验收；本地测试不能声称已验证网页 UI。
- 必须先 Windows 本地测试通过，再提交 feature commit；不要在没有明确授权的情况下推送生产或部署。

## 实现状态（2026-10-25）
- [x] 服务端 `tool-risk.mjs` 建立 Desktop Commander / Cua 受信任风险映射；不信任设备上报的 MCP hints。
- [x] `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` 对全部已知和未知工具保守标注；开放网络工具标记外部访问。
- [x] `start_process` 和 `cua_click` 标为可导致破坏；只读窗口列表标为只读。
- [x] 新增权限面板读取/修改工具 MCP 描述和风险标注。
- [x] 新增 7 个单位测试、1 个真实本地授权 MCP 测试，通过额外 GUI Broker 测试。
- [x] 选定测试 36/36、npm 安装器 7/7、旧 MCP 兼容测试 2/2。
- [ ] 旧 Windows Agent 生命周期/安装器相关的完整回归此前已存在失败，目前未全部解决，不满足整体发布门槛。
- [ ] ChatGPT 对“允许低风险”如何审批具体工具由官方决定；测试平台端实际表现需更新插件并观察。
