# 良配破冰游戏聊天原型

一个可运行的 React/Vite 黑客松原型：系统从一对匹配用户的公开聊天与非敏感资料信号生成专属双人破冰游戏，通过“分别操作 → 保密交接 → 一起揭晓 → 产生后续话题”缓解刚认识时的尴尬停顿。

在线演示：[https://hackathon.shcyr.com](https://hackathon.shcyr.com)

管理后台：[https://hackathon.shcyr.com/admin](https://hackathon.shcyr.com/admin)

## 运行

```bash
npm install
npm run dev
```

默认进入稳定的本地演示案例。页面左侧可以选择“从接口抽一对”，读取比赛提供的随机配对数据。

如需启用接口，在项目根目录创建 `.env`：

```bash
LIANGPEI_TOKEN=你的比赛令牌
ADMIN_PASSWORD_HASH=管理员密码的_scrypt_哈希
CONFIG_ENCRYPTION_KEY=32字节_base64url_主密钥
AI_ALLOWED_ORIGINS=https://api.openai-next.com
AI_GENERATION_PER_HOUR=20
AI_FRESH_PER_CONTEXT=2
```

本地开发时，令牌由 Vite 服务端的 `/api/match` 代理持有，不会进入浏览器包。

生产环境使用 `server/index.mjs` 同时提供静态页面和 API，令牌只保存在服务器环境变量中。先构建，再启动：

```bash
npm run build
LIANGPEI_TOKEN=你的比赛令牌 npm run start:api
```

生产后端包含：

- `/api/health` 健康检查；
- `/api/match` 服务端代理与响应结构校验；
- 上游超时、响应大小限制与每 IP 限流；
- CSP、X-Frame-Options 等安全响应头；
- SPA fallback 和带 hash 资源的长缓存。

## AI 专属游戏与管理后台

前台点击“一起玩”后，只会向同域后端提交一次性的案例上下文 ID 与本人确认过的 Prompt。后端只保留最近 60 条公开聊天，并从双方资料与偏好中提炼 allowlist 内的非敏感兴趣/相处信号；原始资料、记忆、昵称和性别不会发送给模型。随后使用管理后台保存的 OpenAI-compatible 配置调用：

```text
POST {API_BASE_URL}/v1/chat/completions
```

基址也可以直接以 `/v1` 结尾，服务端会避免重复拼接。当前默认基址为 `https://api.openai-next.com`，实际可用模型应在保存 Key 后点击“检测模型”读取。

管理后台支持：

- API Base URL、API Key 和模型；
- 4 个稳定模板 ID、可编辑滚动展示词及每模板生成要求；
- 可编辑的游戏设计系统提示词；
- 使用当前 Key 检测可用模型；
- 显式清除 Key，并让前台自动回退本地题卡。

Key 只在 HTTPS 保存请求中提交一次，使用 AES-256-GCM 加密到仓库外的状态目录；管理接口只返回 `apiKeyConfigured`，不会返回 Key。本地 `.env`、生产 `/etc/hackathon-chat.env`、状态目录和管理员会话都不会进入前端包。

公开生成接口默认最多触发 20 次真实模型调用/小时，同一个 15 分钟案例上下文最多强制换题 2 次；相同请求会复用缓存与进行中的调用。

管理员采用独立 scrypt 密码、服务端 opaque session、`Secure + HttpOnly + SameSite=Strict` Cookie、精确 Origin 与 CSRF token。生产首次部署可在服务器执行：

```bash
node /opt/hackathon-chat/deploy/bootstrap-production.mjs
```

脚本会保留已有比赛 Token，幂等创建加密主密钥、管理员密码哈希及 root-only 的 `/root/hackathon-admin-password`，不会把明文密码打印到日志。

## 当前完成的链路

1. 聊天时间线和接口字段映射；
2. 稳定样例与真实随机案例切换；
3. 双方资料卡并列预览，完整展示 `profile`、`memories_self` 和 `memories_ideal`；
4. A/B 双视角切换，消息归属、发送者、头像与会话对象同步变化；
5. 两个身份分别保存未发送草稿，避免切换后误发对方的内容；
6. 完整展示接口返回的全部聊天记录，包括非文本类型携带的原始内容；
7. 邀请标题在后台启用的玩法关键词之间自动上下滚动；
8. 开始前生成可编辑的本局 Prompt，玩法机制始终由稳定模板 ID 控制；
9. “资料猜谜局”支持双方各选三个词并拼成一句印象，保密交接后共同揭晓；
10. “关键词深挖”支持话题转盘、追问切换与回填聊天；
11. “极限2选1”支持 3–5 题、每题 5 秒、双方私密作答与共同揭晓；
12. “专属小游戏”保留稳定扩展插槽，等待团队模块接入；
13. 未到对应身份时显示隐私门，不暴露未揭晓选择；
14. 游戏中途关闭弹窗会保留进度，五秒题在关闭期间暂停；
15. 检测明确结束信号，避免在不合适的时机继续推游戏；
16. 桌面与移动端响应式布局；
17. 严格 JSON Schema、模板 shape 与本地隐私二次校验，第三方网关不支持时仅对明确格式错误降级 JSON mode；
18. 管理后台配置即时生效，Key 加密落盘且永不回传；
19. AI 未配置、超时、鉴权失败、限流或输出异常时自动回退同玩法安全题库。

## 游戏设计原则

- 不显示匹配度或输赢；猜错被定义为“发现新线索”。
- 本地题卡只使用双方已经在聊天中公开提到的安全话题。
- AI 只接收公开聊天与从 `profile`、`memories_self`、`memories_ideal` 提炼出的非敏感信号，不接收原始私密文本。
- 不自动发送消息，不替用户表白或做关系判断。
- 真正的双端版本必须把锁定答案保存在服务端，在双方完成前禁止另一方读取。

## 验证

```bash
npm run typecheck
npm run test:server
npm run build

# 或一次跑完全部检查
npm run verify
```
