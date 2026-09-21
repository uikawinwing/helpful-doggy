# Helpful Doggy

一个极小的 Discord → SillyTavern DLC 安装原型。

目标只有一条链路：

```text
Discord 私服消息链接
  → 本地 Bridge 用 Bot 权限读取消息和 JSON 附件
  → SillyTavern 扩展识别 JSON 类型
  → Worldbook / Global Regex 自动导入
```

## 现在支持

- Discord 私服消息链接
- 限定单一 Guild
- 限定允许的 Forum/Channel；Forum Thread 会按 parent ID 放行
- 只读取 JSON 附件
- Worldbook：调用 SillyTavern 自带 `importWorldInfo(file)`
- Regex：导入为 Global Regex
- 无数据库、无 R2、无 D1、无网页后台

暂不支持 TavernHelper Script 自动安装。未知 JSON 会显示但不会写入。

## 1. Discord App

把 Bot 安装进目标私服，并至少给目标频道：

- View Channel
- Read Message History

还需要在 Discord Developer Portal 的 Bot 设置中开启 **Message Content Intent**。Discord 会把普通服务器消息的 `content / attachments / embeds / components` 视为 Message Content 数据；不开启时 REST API 返回的附件也可能为空。

这个 prototype 不监听频道消息事件；Message Content Intent 只用于按用户粘贴的 Message Link 精确读取那一条消息。

## 2. Bridge

需要 Node.js 20.6+。

复制 `.env.example` 为 `.env` 后填写：

```env
DISCORD_BOT_TOKEN=...
TARGET_GUILD_ID=...
ALLOWED_CHANNEL_IDS=123456789,987654321
PORT=3210
```

启动：

```bash
npm start
```

`npm start` 会使用 Node 自带的 `--env-file=.env`，没有 dotenv 依赖。

健康检查：`GET http://127.0.0.1:3210/health`

## 3. SillyTavern Extension

仓库根目录本身就是 ST 扩展结构：`manifest.json` + `index.js` + `style.css`。

把本仓库作为第三方扩展安装后，在 Extensions settings 里会看到 **Helpful Doggy**。

默认 Bridge URL：

```text
http://127.0.0.1:3210
```

粘贴 Discord Message Link，点击 **识别并安装**。

当前默认只适合 **SillyTavern 浏览器和 Bridge 在同一台机器** 的测试。如果从手机访问电脑上的 ST，`127.0.0.1` 会指向手机自己；那时需要把 Bridge 暴露成手机能访问的地址。HTTPS 页面也不能直接请求普通 HTTP Bridge，这属于下一阶段部署问题，不在 MVP 里。

## Prototype 安全边界

- Bot Token 只存在 Bridge `.env`，绝不进入 ST 前端。
- Message URL 中的 Guild 必须等于 `TARGET_GUILD_ID`。
- Channel 或 Thread parent 必须属于 `ALLOWED_CHANNEL_IDS`。
- 单附件默认最大 5 MiB。
- 非 JSON 附件忽略。
- 无持久化存储。
- Bridge 默认只监听 `127.0.0.1`。

## 自检

```bash
npm run check
npm test
```

## 下一步（只有验证 MVP 后才考虑）

1. 用真实 DLC 消息验证 private Forum / Thread。
2. 补 TavernHelper Script 的可靠结构识别与现有 importer。
3. 如果需要手机使用，再决定 Bridge 的 LAN / HTTPS 暴露方式。
4. 当前不要加数据库。
