# 模块与 Git 协作

所有模块在私有仓库 `bb-boy/desktop-bridge` 中维护。每个大功能使用自己的分支与独立 Git worktree，集成时保留模块提交和合并记录，不将多个开发进程放在同一个工作目录里写代码。

| 分支 | 所属源码 | 验收重点 |
| --- | --- | --- |
| `module/accounts-pairing` | `bridge/server/management.mjs`、`oauth.mjs`、`security.mjs` | 会话/CSRF、一次性配对、授权撤销、跨账号拒绝、密码变更期间并发请求 |
| `module/task-reliability` | `bridge/server/broker.mjs`、`store.mjs`、`index.mjs` | 健康探测、任务和目录归属、发送和断线竞态、重连结果补领且不重放副作用 |
| `module/universal-client` | `bridge/agent/`、`bridge/client/` | 六种 OS/架构运行时校验、安装/修复/卸载、单实例、进程恢复和协议 v2 |
| `module/google-auth` | `bridge/server/google.mjs` 与身份接入 | Google 唯一身份、签名/issuer/audience/nonce/state/PKCE、显式绑定、独立用户空间 |
| `main` 集成 | `plugin/`、打包脚本、文档、CI | 单一通用 ZIP、模块联合验收、凭据不入库、远端推送 |

模块以 API/协议协调：账号模块拥有用户和授权，配对后设备记录保存 owner；中继按 owner 读取目录并路由；设备只接收带编号的调用和只读恢复请求；客户端先落盘再交付结果。Google 只提供经验证的用户身份，具体设备与任务权限仍由服务端归属检查执行。

`AGENTS.md` 记录协作边界。自动化测试运行于 Node.js 24，CI 为 Windows、macOS、Linux 设置相同的非浏览器验收。CI 的结果以实际远端运行状态为准；本地通过不代表云端所有系统已通过。
