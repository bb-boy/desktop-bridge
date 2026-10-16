# Desktop Bridge

基于 [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) 完整源码开发的自托管远程电脑管理项目。本仓库包含原项目代码、上游主分支历史，以及我们开发的远程连接、账号和设备管理扩展。

当前是开发版本。创建私有仓库和导入代码不代表安装包已经完成发布，也不会变更现有线上服务。

## 代码布局

| 路径 | 内容 |
| --- | --- |
| `src/`、`test/`、`scripts/`、`vendor/` | Desktop Commander 原项目源码、测试、构建脚本和随附组件 |
| `bridge/server/` | 自托管 MCP 中继、账号与 OAuth、设备配对、任务状态与结果保存 |
| `bridge/agent/` | 电脑连接程序、网页配对、本地执行记录、连接恢复 |
| `bridge/public/` | 登录、设备管理和授权管理网页 |
| `bridge/client/` | 客户端运行依赖定义；安装包制作正在进行 |
| `bridge/deploy/` | 现有 Linux 服务和 Windows 后台任务部署脚本 |
| `bridge/test/` | MCP、OAuth、账号隔离、配对、健康检查、结果恢复和密钥轮换集成测试 |
| `plugin/` | 当前自定义插件配置；与上游根目录的插件配置分开保留 |
| `README.upstream.md` | 原项目 README，保留其使用说明和来源 |
| `docs/import/` | 导入的上游提交、扩展文件快照及验证范围 |

## 本地开发

使用 Node.js 24。

构建仓库内的 Desktop Commander 工具引擎：

```sh
npm ci
npm run build
```

安装扩展依赖并执行集成测试：

```sh
npm run bridge:install
npm run bridge:test
```

本次导入的扩展快照已通过 10 项集成测试。上游完整构建、Windows 安装包以及实际宿主中的插件安装不属于本次仓库导入验证范围。

服务端启动命令为 `npm run bridge:start`，通过 `BRIDGE_CONFIG` 指定仓库外的服务配置。电脑端通过 `BRIDGE_AGENT_CONFIG` 或命令行参数指定本地配置。账号密码、设备令牌、数据库及运行日志不提交到仓库。

如需使用本仓库修改后的工具引擎，将电脑端配置的 `runtimeDir` 指向本仓库绝对路径，`mcpEntry` 指向构建生成的 `dist/index.js`。当前 `bridge/client/package.json` 的成品客户端运行依赖仍固定到官方 npm 版本 `0.3.0`；仅修改仓库内源码不会自动改变已安装客户端。

## 开发状态

新增功能的代码与测试已纳入本仓库，但整体仍在开发中：

- 已有设备配对、管理网页、网络与工具健康状态区分、任务结果恢复及多账号隔离的实现与测试。
- `bridge/README.md` 和 `bridge/VALIDATION.md` 保留此前版本的运行记录；其中单用户和手动部署说明属于历史版本，不能视为当前所有功能的说明。
- 一键安装、插件 ZIP 的最终打包、线上迁移和真实电脑验证由后续开发完成。
- `plugin/` 保留原有插件身份与 MCP 地址；导入不会自动更新已安装插件或部署服务器。

## 上游与发布

上游是 `wonderwhy-er/DesktopCommanderMCP`。本地将其保留为 `upstream`，私有仓库作为 `origin`；没有使用 GitHub Fork 关系。导入基点见 `docs/import/upstream.json`。

更新上游时先获取代码并在独立分支合并、测试，再合入 `main`。不要直接覆盖自己的扩展。仓库保留了上游主分支完整历史，没有导入其他分支或上游发布标签。

原项目 GitHub Actions 工作流保存在 `.github/upstream-workflows/`，不自动运行。原项目的 npm 和 MCP Registry 发布配置使用原作者命名空间；本仓库根包已标记 `private: true`。后续需要为本项目独立建立安装包和插件发布流程。

## 许可证与来源

原项目采用 MIT 许可证，原作者版权及许可全文保留在根目录 `LICENSE`。扩展代码的许可证在 `bridge/LICENSE`，第三方来源说明在 `bridge/THIRD_PARTY_NOTICES.md`。

本项目独立开发维护，未声明与 Desktop Commander 官方托管服务存在隶属关系。
