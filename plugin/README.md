# Desktop Bridge · 通用插件

同一份 ZIP 适用于 Windows、macOS 和 Linux，不包含个人密码或设备密钥。

1. 在 ChatGPT「插件」页选择「添加 → 上传插件压缩包」，直接上传此 ZIP，不需要先解压，也不需要填写 MCP 地址。
2. 添加插件后连接 Desktop Bridge，选择「使用 Google 登录」，并确认客户端授权。
3. 在对话中选择该插件，说「列出我的电脑」。已经绑定且工具可用的电脑可直接接受任务。
4. 新电脑在 GPT 中说「帮我安装并连接这台电脑」，首次设置引导会给出对应系统的独立安装器：[Mac](https://mcp.ilovestudy.de/downloads/DesktopBridge-macOS.pkg)、[Windows](https://mcp.ilovestudy.de/downloads/DesktopBridge-Windows.cmd)、[Linux](https://mcp.ilovestudy.de/downloads/DesktopBridge-Linux.sh)。下载并打开后自动准备 Node.js、Desktop Commander 和后台客户端，登录同一个账号并确认设备绑定。Mac / Windows 不需解压和输入命令，Linux 的打开方式取决于桌面环境。
5. 回到 GPT，说「已安装，检查我的电脑」。确认设备工具可用后即可使用。

独立安装器当前未签名，Mac PKG 未公证，系统可能阻止打开。保留系统安全提示，不自动绕过。原有 ZIP 内的三个 `Install.*` 入口继续可用，管理员模式仍需单独明确选择。

上传插件负责连接 ChatGPT 与服务，不会在另一台电脑上自动安装或启动程序。Google 登录和客户端授权后，插件只能使用当前账号已绑定的设备。
设备管理与授权：https://mcp.ilovestudy.de/

启用 Google 登录后，每个 Google 用户直接拥有独立空间，无需邀请。管理员也可在管理页为密码登录用户生成一次性邀请链接。原有所有者的账号名默认为 `owner`，密码继续沿用；压缩包不会包含这个密码。

任务断线后使用 `list_calls` / `get_call_result` 查询，避免重复执行。设备解绑后需要重新配对。安装需要访问官方 Node.js 下载站和 npm registry。插件 ZIP 不会替远端电脑自动启动后台程序；首次在目标电脑运行安装器即可。

本项目为独立自托管服务，复用 MIT 许可的 Desktop Commander 工具引擎，与官方托管服务无隶属关系。源码：https://github.com/bb-boy/desktop-bridge
