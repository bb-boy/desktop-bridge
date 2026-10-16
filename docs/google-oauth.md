# Google 登录与用户隔离

Google OAuth / OpenID Connect 用作用户身份来源。每个通过验证的 `issuer + sub` 对应一个独立 Desktop Bridge 用户；设备、目录、OAuth 客户端授权、任务和结果属于该用户。邮箱只作显示，不作为自动合并账号的依据。

## 服务端启用

1. 在 Google Cloud 的 Google Auth Platform 中创建项目，设置 Branding/Audience 等登录信息。
2. 创建 Web application 类型的 OAuth 客户端。
3. 为当前服务精确登记回调地址：`https://mcp.ilovestudy.de/auth/google/callback`。其他部署域名使用自己的 HTTPS origin 加相同路径。
4. 将 Google 客户端 ID 和客户端密钥写入服务器受保护的配置文件，不能提交到 Git 或插件 ZIP：

```json
{
  "google": {
    "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "clientSecret": "YOUR_SERVER_SIDE_CLIENT_SECRET"
  }
}
```

保留配置中其他字段。没有这两个值时 Google 登录关闭，现有密码登录继续工作。重启服务后才生效。Google 项目处于 Testing 状态时，按 Google 控制台要求添加测试用户；是否发布及验证以控制台实际状态为准。

## 用户行为

- 新用户使用 Google 登录，自动拥有独立空间，不能看见原 `owner` 或其他 Google 用户的设备。
- 原用户先登录现有账号，再在“授权与账号”中选择“绑定 Google 账号”。绑定操作明确授权，不依据邮箱自动合并。
- 使用 Google 登录后仍要主动确认 MCP 客户端授权；登录本身不授予客户端操作电脑的权限。
- 只有仍有其他登录方式时才能解除 Google 绑定，避免失去账号访问能力。

Google 回调检查短期一次性 state、浏览器绑定、nonce、PKCE，以及 ID token 的签名、issuer、audience、过期时间和已验证邮箱。插件和客户端不保存 Google 客户端密钥；服务不需要读取用户的 Gmail、Drive 或其他 Google 数据。

代码可通过本地签名令牌与模拟端点完成协议验证。实际 Google 登录需要自己的客户端凭据及回调配置，未配置时不能宣称已经完成真实 Google 端到端验证。

参考：[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)、[Google Web Server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)。
