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

## 1. Discord Bot

创建 Bot，并至少给目标频道：

- View Channel
- Read Message History

这个 prototype 不监听普通消息事件，因此不需要依赖 Message Content Intent。

## 2. Bridge

需要 Node.js 20+。

复制 `.env.example` 为 `.env` 后填写：

```env
DISCORD_BOT_TOKEN=...
TARGET_GUILD_ID=...
ALLOWED_CHANNEL_IDS=123456789,987654321
PORT=3210
```

注意：当前 prototype 本身不加载 `.env` 文件。启动前请让这些变量进入进程环境；后续可以再加 dotenv。

启动：

```bash
npm start
```

健康检查：`GET http://127.0.0.1:3210/health`

## 3. SillyTavern Extension

仓库根目录本身就是 ST 扩展结构：`manifest.json` + `index.js` + `style.css`。

把本仓库作为第三方扩展安装后，在 Extensions settings 里会看到 **Helpful Doggy**。

默认 Bridge URL：

```text
http://127.0.0.1:3210
```

粘贴 Discord Message Link，点击 **识别并安装**。

## Prototype 安全边界

- Bot Token 只存在 Bridge 环境变量，绝不进入 ST 前端。
- Message URL 中的 Guild 必须等于 `TARGET_GUILD_ID`。
- Channel 或 Thread parent 必须属于 `ALLOWED_CHANNEL_IDS`。
- 单附件默认最大 5 MiB。
- 非 JSON 附件忽略。
- 无持久化存储。

## 下一步（只有验证 MVP 后才考虑）

1. 用真实 DLC 消息验证 private Forum / Thread。
2. 补 TavernHelper Script 的可靠结构识别与官方/现有 importer。
3. 再决定是否需要 Discord OAuth；当前不要加数据库。
