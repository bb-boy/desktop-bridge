# Desktop Bridge · 通用插件

同一份 ZIP 适用于 Windows、macOS 和 Linux，不包含个人密码或设备密钥。

1. 将此 ZIP 安装到支持该插件格式的宿主，并关联你的 Desktop Bridge 账号。
2. 首次连接一台电脑时，在该电脑解压同一个 ZIP，运行 `Install.cmd`（Windows）、`Install.command`（macOS）或 `Install.sh`（Linux）。
3. 安装器自动准备运行环境。浏览器打开后登录账号，确认设备名称并绑定；无浏览器的电脑可把配对码输入到其他设备上的管理页。
4. 在对话里使用插件，先列出设备，再进行文件或终端操作。

设备管理与授权：https://mcp.ilovestudy.de/

启用 Google 登录后，每个 Google 用户直接拥有独立空间，无需邀请。管理员也可在管理页为密码登录用户生成一次性邀请链接。原有所有者的账号名默认为 `owner`，密码继续沿用；压缩包不会包含这个密码。

任务断线后使用 `list_calls` / `get_call_result` 查询，避免重复执行。设备解绑后需要重新配对。安装需要访问官方 Node.js 下载站和 npm registry。插件 ZIP 不会替远端电脑自动启动后台程序；首次在目标电脑运行安装器即可。

本项目为独立自托管服务，复用 MIT 许可的 Desktop Commander 工具引擎，与官方托管服务无隶属关系。源码：https://github.com/bb-boy/desktop-bridge
