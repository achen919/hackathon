# 良配破冰游戏聊天原型

一个可运行的 React/Vite 黑客松原型：系统根据一对匹配用户的公开聊天与当前场景允许的安全上下文生成专属双人破冰游戏，通过“分别操作 → 保密交接 → 一起揭晓 → 产生后续话题”缓解刚认识时的尴尬停顿。

在线演示：[https://hackathon.shcyr.com](https://hackathon.shcyr.com)

游园会真实匹配：[https://hackathon.shcyr.com/carnival](https://hackathon.shcyr.com/carnival)

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
IMAGE_AI_ALLOWED_ORIGINS=https://tokendance.space
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
- `/api/carnival/*` 异性排队、双端聊天、持久化邀请与服务端游戏状态。

## 游园会真实匹配

首页的“我也要聊”会进入独立的游园会体验。用户选择性别和昵称后按异性 FIFO 配对；房间内双方累计发送 10 条文字消息后，同时解锁游戏摊位。双方可以并发发起多张邀请，每张邀请都有独立 `inviteId`，点击哪张卡片就进入哪位用户发起的那一局。

会话、消息、邀请和未揭晓的游戏进度原子写入 `STATE_DIR/carnival-state.json`。浏览器只保存一次性 opaque token，磁盘只保存其哈希；资料猜谜和极限二选一在双方完成前不会向对方投影具体答案。AI 生成不可用时仍使用同模板的本地安全题卡，不中断现场体验。

## AI 专属游戏与管理后台

默认 Demo 点击“一起玩”后，只会向同域后端提交一次性的案例上下文 ID 与本人确认过的 Prompt。后端保留最近 60 条公开聊天，并可从 Demo 接口返回的 `profile`、`memories_self`、`memories_ideal` 与择偶偏好中提炼 allowlist 内的非敏感兴趣/相处信号；原始私密文本、昵称和性别不会发送给模型。资料猜谜局采用更窄的边界，只使用公开 `profile`、公开聊天和显式的公开资料信号，不读取 `memories_self`、`memories_ideal` 或择偶偏好。

游园会的真实用户注册只收集昵称和性别，没有 Demo 的资料与记忆字段。因此游园会「专属小游戏」只使用当前房间中清洗、截断后的最近公开聊天片段与安全话题信号；昵称和性别仅用于匹配与界面展示，不作为题目推断依据。

两个场景都使用管理后台保存的 OpenAI-compatible 配置调用：

```text
POST {API_BASE_URL}/v1/chat/completions
```

基址也可以直接以 `/v1` 结尾，服务端会避免重复拼接。当前默认基址为 `https://api.openai-next.com`，实际可用模型应在保存 Key 后点击“检测模型”读取。

结果卡背景使用独立的生图配置。默认按 TokenDance 的 Ark 生图协议请求 Seedream 5.0 Pro：

```text
POST https://tokendance.space/gateway/ark/v3/images/generations
Authorization: Bearer <独立生图 Key>
model: seedream-5.0-pro
protocol: ark:image-generations
```

Base URL、请求路由、协议、模型和生图 Key 都可在管理后台修改；Ark 请求使用 `2K`、PNG、Base64 响应且关闭水印。文本模型与生图模型使用两套独立 Key，任一服务失败时仍保留可用的本地题卡或文字结果卡。

管理后台支持：

- 文本模型的 API Base URL、API Key 和模型；
- 结果卡生图的 Base URL、请求路由、协议、独立加密 Key 和模型；
- 4 个稳定模板 ID、可编辑滚动展示词及每模板生成要求；`custom` 模板内另有 6 个稳定专属系列 ID，其中 `prompt-arcade` 支持一句话生成可玩预览；
- 可编辑的游戏设计系统提示词；
- 使用当前 Key 检测可用模型；
- 显式清除 Key，并让前台自动回退本地题卡。

两套 Key 都只在 HTTPS 保存请求中提交一次，使用 AES-256-GCM 分别加密到仓库外的状态目录；管理接口只返回 `apiKeyConfigured` / `imageApiKeyConfigured`，不会返回任何 Key。本地 `.env`、生产 `/etc/hackathon-chat.env`、状态目录和管理员会话都不会进入前端包。

管理端还可以编辑结果卡生图 Prompt。服务端会把该基础 Prompt 与最近公开对话状态、本局游戏和结果组合后再请求生图模型；只使用 A/B 说话方标识，并限制条数与长度、过滤联系方式和链接，不会把昵称或原始私密资料发送给生图上游。

公开生成接口默认最多触发 20 次真实模型调用/小时，同一个 15 分钟案例上下文最多强制换题 2 次；相同请求会复用缓存与进行中的调用。

管理员采用独立 scrypt 密码、服务端 opaque session、`Secure + HttpOnly + SameSite=Strict` Cookie、精确 Origin 与 CSRF token。生产首次部署可在服务器执行：

```bash
node /opt/hackathon-chat/deploy/bootstrap-production.mjs
```

脚本会保留已有比赛 Token，幂等创建加密主密钥、管理员密码哈希及 root-only 的 `/root/hackathon-admin-password`，不会把明文密码打印到日志。

## 自动部署

合并 PR 到 `main` 或直接更新 `main` 会触发 GitHub Actions 生产发布：先在无生产凭据的独立 runner 完成完整验证和构建，再由新的 runner 使用 `production` 环境中的专用 SSH 密钥调用服务器固定发布程序。服务器会校验 exact SHA、归档结构和静态资源，原子切换代码，并在健康检查失败时同步回滚代码、静态文件与状态快照。详细契约与一次性配置见 [生产部署文档](docs/production-deployment.md)。

## 当前完成的链路

1. 聊天时间线和接口字段映射；
2. 稳定样例与真实随机案例切换；
3. 演示案例的双方资料卡并列预览，完整展示 `profile`、`memories_self` 和 `memories_ideal`；原始文本不直接进入模型，后端仅可提炼 allowlist 内的非敏感信号；
4. A/B 双视角切换，消息归属、发送者、头像与会话对象同步变化；
5. 两个身份分别保存未发送草稿，避免切换后误发对方的内容；
6. 完整展示接口返回的全部聊天记录，包括非文本类型携带的原始内容；
7. 邀请标题在后台启用的玩法关键词之间自动上下滚动；
8. 开始前生成可编辑的本局 Prompt；内置玩法由稳定模板 ID 控制，专属小游戏则由受限声明式引擎把 Prompt 编译为可试玩的视觉与交互；
9. “资料猜谜局”会分别根据当前被猜的 TA 的公开线索，动态挑选三个不同生活场景，每组给三个行为候选；双方各组选一个，由服务端拼成固定安全句式，保密交接后共同揭晓；
10. “关键词深挖”支持话题转盘、追问切换与回填聊天；
11. “极限2选1”支持 3–5 题、每题 5 秒、双方私密作答与共同揭晓；
12. “专属小游戏”使用 `templateId: custom`，内置 6 个稳定 `seriesId`，并复用游园会的独立 `inviteId` 与真实双端保密揭晓流程；
13. 未到对应身份时显示隐私门，不暴露未揭晓选择；
14. 游戏中途关闭弹窗会保留进度，五秒题在关闭期间暂停；
15. 检测明确结束信号，避免在不合适的时机继续推游戏；
16. 桌面与移动端响应式布局；
17. 严格 JSON Schema、模板 shape 与本地隐私二次校验，第三方网关不支持时仅对明确格式错误降级 JSON mode；
18. 管理后台配置即时生效，Key 加密落盘且永不回传；
19. AI 未配置、超时、鉴权失败、限流或输出异常时自动回退同玩法安全题库。
20. “我也要聊”支持昵称/性别入场、异性 FIFO 匹配与双端真实聊天；
21. 房间累计 10 条消息后双方同时解锁游戏，不要求每人各发 10 条；
22. 双方可同时发起不同游戏，时间线保留所有独立邀请，按 `inviteId` 精确开局；
23. 联网资料猜谜、共享转盘和极限二选一均由服务端保存状态，刷新后可恢复；
24. 演示案例与游园会共用后台模板配置、AI Key 和全局调用预算。
25. `prompt-arcade` 支持“写 Prompt → 生成 → 立即试玩 → 用这个版本发邀请”，邀请严格绑定试玩过的同一份游戏定义；
26. Prompt-to-Game 引擎可组合互动卡片、双向滑卡、情绪刻度盘和星轨选择器，并让三轮使用不同的安全交互；
27. 模型只生成经过严格 schema 校验的声明式 JSON，不执行模型提供的 HTML、CSS、JavaScript、URL、组件或事件代码；AI 不可用时由本地 Prompt 编译器生成同协议的可玩版本。

## 游戏设计原则

- 不显示匹配度或输赢；猜错被定义为“发现新线索”。
- 本地题卡只使用双方已经在聊天中公开提到的安全话题。
- 默认 Demo 的 AI 接收公开聊天，以及从 `profile`、`memories_self`、`memories_ideal` 和择偶偏好中提炼的 allowlist 非敏感信号，不接收这些字段的原始私密文本；资料猜谜局除外，它只使用公开 `profile`、公开聊天和显式的公开资料信号。
- 游园会专属小游戏只接收当前房间中清洗、截断后的最近公开聊天片段与安全话题信号，不使用昵称或性别推断内容。
- 不自动发送消息，不替用户表白或做关系判断。
- 双端玩法把答案保存在服务端，并按当前参与者投影状态；双方完成前不会返回对方具体选择。

专属小游戏的稳定 `seriesId`、Prompt、`inviteId`、双端 `answer / guess` 和 AI 失败回退契约见 [docs/exclusive-games.md](docs/exclusive-games.md)。

## 验证

```bash
npm run typecheck
npm run test:server
npm run build

# 或一次跑完全部检查
npm run verify
```
