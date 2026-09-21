# Helpful Doggy

一个小型 Discord → SillyTavern DLC 安装、版本登记与原地更新原型。

## 核心流程

```text
Discord Forum Thread
  ├─ 发布者发带 JSON 附件的消息
  ├─ /release version:1.2.3 message:<该消息链接>
  │    └─ Helpful Doggy 记录版本 → source message
  │
  └─ /latest
       └─ 直接返回这个 DLC 最新登记版本和消息链接

消息链接
  → 本地 Bridge 用 Bot 权限读取 JSON 附件
  → SillyTavern 扩展识别类型
  → Worldbook / Global Regex 自动导入
```

不需要 D1、R2、MySQL 或网页后台。

## 当前支持

- Discord 私服 Forum Thread / Message Link
- 单一 Guild 白名单
- Forum / Channel 白名单
- Worldbook 自动导入
- Global Regex 自动导入
- 每个 Forum Thread 自动成为一个 DLC package，不需要作者手填 package ID
- package key = `guildId:threadId`
- `/release` 登记版本
- `/latest` 查询最新版
- 直接粘贴 Thread URL 时，如果已经登记 release，会自动取 latest release message
- release registry 存在本地 `data/releases.json`
- registry 只保存版本和 Discord message pointer，不复制附件

暂不支持 TavernHelper Script 自动安装。

## Discord App

Bot 至少需要目标 Forum 的：

- View Channel
- Read Message History

Discord Developer Portal → Bot：

- 开启 **Message Content Intent**

Bot 需要能使用 application commands。启动后 Helpful Doggy 会自动把 `/release` 和 `/latest` 注册到 `TARGET_GUILD_ID`。

## 版本管理

### 发布版本

先在 DLC 的 Forum Thread 里正常发送本版本 JSON，然后 Copy Message Link。

在同一个 Thread 执行：

```text
/release version:1.2.3 message:https://discord.com/channels/...
```

限制：

- Message Link 必须指向当前 Thread 内的具体消息
- 该消息至少有一个 JSON 附件
- 只有 Thread 作者或服务器 **Administrator** 能登记
- 同一个版本重新登记时，会用新的消息替换旧记录，并成为当前 latest
- “latest”表示**最后登记的 release**，不自动比较版本号大小

### 获取最新版

任何能进入该 Thread 的用户都可以：

```text
/latest
```

Bot 会返回：

```text
Latest: 1.2.3
https://discord.com/channels/.../.../...
登记时间：...
```

把这个 Message Link 或整个 Thread Link 贴进 SillyTavern 的 Helpful Doggy 即可安装。Thread Link 会优先解析已经登记的 latest release。

## Bridge

需要 Node.js 20.6+。

复制：

```text
.env.example → .env
```

填写：

```env
DISCORD_BOT_TOKEN=...
TARGET_GUILD_ID=...
ALLOWED_CHANNEL_IDS=123456789,987654321
HOST=0.0.0.0
PORT=3210
RELEASE_STORE_PATH=./data/releases.json
```

启动：

```bash
npm install
npm start
```

健康检查：

```text
GET http://127.0.0.1:3210/health
```

正常运行并完成 slash command 注册时：

```json
{
  "ok": true,
  "discordReady": true,
  "commandsReady": true
}
```

手机访问电脑上的 Bridge 时，使用电脑 LAN IP，例如：

```text
http://192.168.1.20:3210
```

## SillyTavern Extension

仓库根目录本身就是 ST extension：

- `manifest.json`
- `index.js`
- `style.css`

### 自动 package identity

Helpful Doggy 不要求作者填写 DLC ID。

```text
packageKey = guildId + ":" + threadId
```

Thread 名字可以改，但 Discord Thread ID 不变，因此同一个 Thread 的后续 release 会被识别为同一个 package。

### ST 侧安装 Registry

第一次安装时，Helpful Doggy 会创建：

```text
[Helpful Doggy] Registry
[Helpful Doggy] DLC
```

其中：

- `[Helpful Doggy] Registry`：只放 disabled metadata entry，不参与 prompt
- `[Helpful Doggy] DLC`：实际 Worldbook entries
- Global Regex 仍保存在 ST 的 Global Regex

Registry entry 的 `content` 保存：

```json
{
  "packageKey": "guildId:threadId",
  "version": "1.2.3",
  "sourceMessageId": "...",
  "assets": {
    "worldbook": {},
    "regex": {}
  }
}
```

不使用 Worldbook `extra` 存 Helpful Doggy metadata。

### 原地更新

再次安装同一 Thread 的新版时：

```text
Discord Thread
→ packageKey 相同
→ 查 [Helpful Doggy] Registry
→ 找到本机旧 Worldbook UID / Regex ID
→ 覆盖旧项目
→ 不重复 append
```

当前匹配规则：

- Worldbook entry：package + 附件文件名 + source UID
- Regex：优先 source Regex `id`；没有 ID 时回退到文件名 + scriptName

因此正常的“同一个文件继续更新并导出”会原地覆盖。若作者同时改了文件名和 source UID，目前会被视为新资产；删除旧资产的自动清理也暂未启用，避免误删。

### 当前导入目标

- Worldbook → `[Helpful Doggy] DLC`
- Regex → Global Regex
- 未识别 JSON → 显示错误，不写入
- TavernHelper Script → 暂未自动安装

## 安全边界

- Bot Token 只存在本地 Bridge 的 `.env`
- Guild 必须等于 `TARGET_GUILD_ID`
- Channel 或 Thread parent 必须属于 `ALLOWED_CHANNEL_IDS`
- release 不能指向其他 Thread
- 只有帖主 / Administrator 可以登记 release
- 单附件默认最大 5 MiB
- 非 JSON 附件不安装
- `data/releases.json` 不提交 Git
- ST Registry entry 默认 disabled，不参与 prompt

## 自检

```bash
npm run check
npm test
```
