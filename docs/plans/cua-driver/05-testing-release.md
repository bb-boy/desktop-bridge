# Feature 05 — Windows 验证、回归与发布门禁

## 目标
保证集成不破坏现有 Desktop Bridge；研发和测试只在 Windows p111 上完成，不使用 Mac 电脑。

## 顺序
1. 从最新 `origin/main` 创建独立 Windows Git worktree 与 `feature/cua-driver-mcp-windows` 分支；保存现有工作区的未跟踪许可证文件。
2. 编写 MCP Manager 单元测试：双后端发现/调用、前缀路由、失败隔离、关闭清理、目录碰撞。
3. 添加 Windows 模拟 Cua MCP Server 集成测试，不要求安装 GUI 驱动即可覆盖协议。
4. 可用时执行 Windows 真实 Cua Driver 只读 smoke：`list_apps`、`list_windows`、`get_window_state`；写入/点击测试必须使用明确授权的测试应用。
5. 执行 `npm test --prefix bridge`、必要 Node 语法检查与 `git diff --check`。
6. 检查 `git status` 与变更清单，提交 feature 分支；禁止未经要求直接合并 main、部署线上或更新所有用户的安装器。

## 验收
- [ ] 全程 Windows 操作证据。
- [ ] 所有新增功能存在独立计划文件与相应测试。
- [ ] Desktop Commander 保持可用，Cua 缺失不影响现有用户。
- [ ] 测试输出可复现，明确列出未完成/未验证事项。
- [ ] 未自动部署生产版。
