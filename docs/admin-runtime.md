# Desktop Bridge 0.2.1：管理员模式与后台运行

> 适用于 **用户本人授权管理的设备**。管理员模式为可选项，普通安装默认不提权。此功能已经通过代码和集成测试，但尚未分别在 Windows、macOS 和 Linux 完成真实系统服务安装、启动、重启及卸载验收。部署前请先在测试设备上验证。

## 两种运行模式

| 运行模式 | 管理员授权 | 运行方式 | 何时停止 |
| --- | --- | --- | --- |
| 手动（`manual`） | 每次启动请求系统授权；本次进程复用权限 | 当前窗口运行 | Ctrl+C 或关闭窗口 |
| 后台（`background`） | 安装或更新系统服务时明确授权 | 系统以管理员身份启动和维护服务 | 显式停止、切换模式或卸载 |

不添加 `--administrator` 的普通运行模式，仍使用当前用户权限。普通后台模式是**用户登录后自启**，并不等于管理员系统服务。

管理员权限不会取代 Google 登录、账号/设备隔离、ChatGPT 的工具确认或 macOS 隐私授权（TCC）。后台服务与用户桌面会话不同：GUI 交互、登录用户钥匙串、网络盘以及屏幕录制等功能可能不可用。请勿为解决这些限制而绕过系统的授权提示。

## 一份插件 ZIP，三个操作系统

解压同一份插件 ZIP，找到根目录的安装入口，或进入 `assets/client/` 后调用安装器。建议先正常登录/配对，再决定是否启用管理员模式。保持 Node 24 的独立运行环境，首次安装会按固定 SHA-256 下载并验证官方运行时及依赖。

**macOS / Linux：**

```sh
# 普通手动模式
./Install.sh --mode manual

# 手动管理员模式：本次启动需要 sudo 授权
./Install.sh --mode manual --administrator

# 管理员后台模式：系统服务安装需要 sudo 授权
./Install.sh --mode background --administrator
```

**Windows（PowerShell 或 cmd）：**

```powershell
.\Install.cmd --mode manual
.\Install.cmd --mode manual --administrator
.\Install.cmd --mode background --administrator
```

`Install.command` 适用于双击运行的 macOS 安装入口；需要选择具体模式时可在终端传参执行。安装器会保留已配对设备的凭据，不应把设备密钥写入文档、仓库、截图或公开安装包中。

## 管理员后台服务与受保护目录

| 系统 | 服务管理 | 受保护的运行目录 |
| --- | --- | --- |
| Windows | Task Scheduler：SYSTEM / Highest / 开机启动 | `C:\ProgramData\DesktopBridge\Administrator` |
| macOS | root LaunchDaemon | `/Library/Application Support/DesktopBridge/Administrator` |
| Linux | root systemd system service | `/var/lib/desktop-bridge-administrator` |

系统服务仅从受保护目录读取 Node 运行时、Agent、MCP 工具及依赖，普通账号不能直接替换后台管理员程序文件。安装/更新需要系统授权，并验证目录权限及文件路径。客户端只向外建立 WSS 连接，服务端不需要以 root/SYSTEM 运行。

**风险提示：** 管理员模式下，用户已允许使用的本地终端和文件工具具有广泛的系统权限；网络或账号被攻破时风险显著高于普通模式。优先使用普通模式，仅在确实需要时启用管理员模式，并及时撤销不再使用的设备和客户端授权。

## 启动、停止、切换和卸载

安装后，在当前用户的客户端目录中使用 `Start.command` / `Stop.command`、`Start.cmd` / `Stop.cmd` 或 `start.sh` / `stop.sh`。管理员模式会由操作系统再次请求所需授权。运行模式可通过客户端的 `control.mjs mode manual|background` 切换；切换为管理员后台运行时需要经过系统授权。

需要撤销管理员安装时，通过用户客户端目录中的已安装 Node 环境运行 `admin-elevate.mjs uninstall`；只有明确追加 `--purge` 才删除保存的凭据和任务日志。卸载本地程序后仍需在管理页解绑/撤销设备令牌。

停止与卸载要区分：停止只是让代理离线；暂停或解绑阻止后续工具调用，**但可能无法取消已经在本机执行的操作**。如果任务状态为「结果未知」，应先检查实际结果，再决定是否重试，避免重复修改。

## 开发、验证和发布边界

```sh
npm ci --prefix bridge --ignore-scripts
npm test --prefix bridge
python3 bridge/scripts/package-plugin.py --output release-output/desktop-bridge-plugin.zip
```

2026-10-17 本地 macOS Node.js 24.19.0 集成测试结果：**88 项，87 通过、1 跳过、0 失败**。跳过的为 Windows 专项测试。管理员系统服务当前只有单元/静态验证；尚无原生管理员安装的实机验收。此前 p111 的 Windows Agent 实际连接验证，不等于 Windows 管理员系统服务验收。

前端管理页更新了登录页面、设备卡片、状态统计、任务记录和窄屏布局；保留原有 API 路由、登录/配对流程及 DOM 操作接口。管理页在 macOS Chrome Headless 以模拟账号/设备完成 1366px 和 390px 布局及键盘标签切换烟测，且没有横向溢出；但不代表真实 Google 登录或跨浏览器视觉回归验收。发布前还应检查 Safari、Edge、实际移动设备和隐私授权提示。

**Git 推送和插件打包不自动部署线上服务。** 上线必须单独备份现有配置、数据库和设备凭据，完成真实操作系统验收后再执行有控制的更新。
