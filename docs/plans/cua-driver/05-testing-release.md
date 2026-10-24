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

## 本次 Windows 测试快照（2026-10-25）
- [x] 在 Windows p111 上使用 `Microsoft.WindowsCalculator_8wekyb3d8bbwe!App` AUMID 后台启动计算器。
- [x] 通过 `get_window_state` 的 UI Automation 元素令牌执行 clear、6、multiply、7、equal；结果为 42。
- [x] Cua 窗口截图可通过 MCP 返回（约 35 KB）。
- [x] 临时 Broker + 临时 Agent + 实际 Cua Driver 的多 MCP 工具发现、`cua_list_windows`、`cua_launch_app`、`cua_get_window_state`（图片）完整端到端通过。
- [x] 新增 MCP Manager 7/7 通过、npm 安装器 7/7 通过、npm dry-run 打包文件清单校验通过（前一阶段）。
- [ ] 原有 `npm test --prefix bridge` 未全部通过：一部分旧 Agent 端到端测试超时，Windows 安装器相关用例失败，仍需排查；不能发布/合并。
- [ ] 当前测试使用临时设备凭据和测试服务器，不改写运行中的 p111 Desktop Bridge Agent 配置。
- [ ] 尚未推送功能分支、创建 PR、合并或部署。

## 2026-10-25 Windows 全量回归修复完成
- [x] 查明原来的 Agent 重连、解绑、关闭测试失败原因是 Windows 测试 teardown 在子进程退出前删除临时目录，导致 EPERM。
- [x] `reliability.test.mjs` 与 `bridge.test.mjs` fixture 统一追踪并提前停止其创建的子进程，再关闭服务器与删除目录；核心 29/29 通过。
- [x] Windows 没有符号链接创建权限时单独跳过符号链接逃逸测试，其他管理员权限测试正常执行。
- [x] `dataRoot` 依据目标平台使用正确路径分隔符，修复模拟 darwin/linux 的 Windows 测试。
- [x] Windows 上使用 maintenance.flag 验证 Agent 正常退出，不再把 `child.kill('SIGTERM')` 误当优雅退出。
- [x] POSIX `/bin/sh` 执行断言仅在 POSIX 环境运行；保留 Windows 命令引用检查。
- [x] downloads fixture 在服务器关闭后删除临时目录；标准测试通过。
- [x] 验证 `--test-force-exit` 在 Windows Node 中触发 libuv assert 的测试运行器问题，正式验收使用原项目标准命令，无需强制退出。
- [x] `npm test --prefix bridge`：146 个测试，129 通过、0 失败、17 跳过（符合当前 Windows OS 和权限环境），Exit 0。
- [x] `npm test --prefix npm-installer`：7/7 通过。
- [x] 真机 Windows Broker + Cua Driver 端到端权限拦截与截图测试通过。
- [ ] GitHub CI 的其他操作系统和 ChatGPT 网页 MCP Apps 实际渲染仍待 PR 与测试环境验收；不直接发布生产。
