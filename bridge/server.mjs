import http from "node:http";
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { parseDiscordMessageLink } from "./message-link.mjs";
import { ReleaseStore, makePackageKey } from "./release-store.mjs";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const targetGuildId = process.env.TARGET_GUILD_ID?.trim();
const allowedChannelIds = new Set(
  (process.env.ALLOWED_CHANNEL_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const host = process.env.HOST?.trim() || "0.0.0.0";
const port = Number(process.env.PORT || 3210);
const maxAttachmentBytes = Number(
  process.env.MAX_ATTACHMENT_BYTES || 5 * 1024 * 1024,
);
const releaseStorePath =
  process.env.RELEASE_STORE_PATH?.trim() || "./data/releases.json";
const DISCORD_API = "https://discord.com/api/v10";

if (!token || !targetGuildId || allowedChannelIds.size === 0) {
  console.error(
    "Missing DISCORD_BOT_TOKEN, TARGET_GUILD_ID, or ALLOWED_CHANNEL_IDS.",
  );
  process.exit(1);
}

const releaseStore = new ReleaseStore(releaseStorePath);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > 65536) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function discordGet(path) {
  const response = await fetch(DISCORD_API + path, {
    headers: { authorization: "Bot " + token },
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(
      "Discord API " + response.status + ": " + text.slice(0, 300),
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function isAllowedDiscordChannel(channel) {
  if (String(channel.guild_id ?? "") !== targetGuildId) return false;
  const channelId = String(channel.id ?? "");
  const parentId = String(channel.parent_id ?? "");
  return allowedChannelIds.has(channelId) || allowedChannelIds.has(parentId);
}

function isAllowedThreadChannel(channel) {
  if (!channel?.isThread?.()) return false;
  return (
    allowedChannelIds.has(String(channel.id)) ||
    allowedChannelIds.has(String(channel.parentId ?? ""))
  );
}

function isJsonAttachment(attachment) {
  const filename = String(attachment.filename ?? attachment.name ?? "").toLowerCase();
  const contentType = String(
    attachment.content_type ?? attachment.contentType ?? "",
  ).toLowerCase();

  return filename.endsWith(".json") || contentType.includes("application/json");
}

async function downloadJsonAttachment(attachment) {
  const base = {
    id: attachment.id,
    filename: attachment.filename,
    size: attachment.size,
    contentType: attachment.content_type ?? null,
  };

  if (!isJsonAttachment(attachment)) {
    return { ...base, status: "ignored", reason: "not-json" };
  }

  if (Number(attachment.size ?? 0) > maxAttachmentBytes) {
    return { ...base, status: "ignored", reason: "too-large" };
  }

  const response = await fetch(attachment.url);
  if (!response.ok) {
    return {
      ...base,
      status: "error",
      reason: "download-" + response.status,
    };
  }

  const text = await response.text();
  try {
    JSON.parse(text);
  } catch {
    return { ...base, status: "error", reason: "invalid-json" };
  }

  return { ...base, status: "ready", text };
}

const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

async function resolveMessage(messageUrl) {
  const parsed = parseDiscordMessageLink(messageUrl);
  if (!parsed) {
    return { status: 400, body: { error: "invalid_message_url" } };
  }

  if (parsed.guildId !== targetGuildId) {
    return { status: 403, body: { error: "guild_not_allowed" } };
  }

  const channel = await discordGet("/channels/" + parsed.channelId);
  if (!isAllowedDiscordChannel(channel)) {
    return { status: 403, body: { error: "channel_not_allowed" } };
  }

  const isThread = THREAD_CHANNEL_TYPES.has(Number(channel.type));
  const threadId = isThread ? parsed.channelId : null;
  let release = null;
  let message;

  if (parsed.messageId) {
    message = await discordGet(
      "/channels/" + parsed.channelId + "/messages/" + parsed.messageId,
    );

    if (threadId) {
      release = await releaseStore.getReleaseByMessage(threadId, message.id);
    }
  } else {
    if (!isThread) {
      return { status: 400, body: { error: "thread_link_required" } };
    }

    release = await releaseStore.getLatestRelease(threadId);

    if (release) {
      message = await discordGet(
        "/channels/" + threadId + "/messages/" + release.messageId,
      );
    } else {
      try {
        message = await discordGet(
          "/channels/" + threadId + "/messages/" + threadId,
        );
      } catch (error) {
        if (error?.status !== 404) throw error;

        const messages = await discordGet(
          "/channels/" + threadId + "/messages?limit=100",
        );

        if (!Array.isArray(messages) || messages.length === 0) {
          return { status: 404, body: { error: "thread_empty" } };
        }

        message = [...messages].sort((a, b) =>
          String(a.timestamp).localeCompare(String(b.timestamp)),
        )[0];
      }
    }
  }

  const attachments = await Promise.all(
    (message.attachments ?? []).map(downloadJsonAttachment),
  );

  return {
    status: 200,
    body: {
      package: threadId
        ? {
            key: makePackageKey(parsed.guildId, threadId),
            guildId: parsed.guildId,
            threadId,
            version: release?.version ?? null,
            registered: Boolean(release),
            releaseMessageId: release?.messageId ?? null,
          }
        : null,
      message: {
        id: message.id,
        channelId: parsed.channelId,
        guildId: parsed.guildId,
        author: {
          id: message.author?.id ?? null,
          username: message.author?.username ?? null,
        },
        content: message.content ?? "",
        timestamp: message.timestamp ?? null,
      },
      attachments,
    },
  };
}

const releaseCommand = new SlashCommandBuilder()
  .setName("release")
  .setDescription("登记当前 DLC 帖子的一个版本")
  .addStringOption((option) =>
    option
      .setName("version")
      .setDescription("版本号，例如 1.2.3")
      .setRequired(true)
      .setMaxLength(64),
  )
  .addStringOption((option) =>
    option
      .setName("message")
      .setDescription("包含本版本 JSON 附件的 Discord 消息链接")
      .setRequired(true),
  );

const latestCommand = new SlashCommandBuilder()
  .setName("latest")
  .setDescription("取得当前 DLC 帖子登记的最新版本");

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds],
});
let commandsReady = false;

discordClient.once(Events.ClientReady, async (client) => {
  console.log("Helpful Doggy bot logged in as " + client.user.tag);

  try {
    const guild = await client.guilds.fetch(targetGuildId);
    await guild.commands.set([releaseCommand.toJSON(), latestCommand.toJSON()]);
    commandsReady = true;
    console.log("Helpful Doggy guild slash commands registered.");
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }
});

discordClient.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== targetGuildId) return;

  try {
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (!isAllowedThreadChannel(channel)) {
      await interaction.reply({
        content: "这个命令只能在已允许的 DLC Forum Thread 里使用。",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "release") {
      const isThreadOwner = String(channel.ownerId ?? "") === interaction.user.id;
      const isAdministrator =
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
        false;

      if (!isThreadOwner && !isAdministrator) {
        await interaction.reply({
          content: "只有这个帖子的作者或服务器 Administrator 可以登记版本。",
          ephemeral: true,
        });
        return;
      }

      const version = interaction.options.getString("version", true).trim();
      const messageUrl = interaction.options.getString("message", true).trim();
      const parsed = parseDiscordMessageLink(messageUrl);

      if (
        !parsed ||
        !parsed.messageId ||
        parsed.guildId !== targetGuildId ||
        parsed.channelId !== interaction.channelId
      ) {
        await interaction.reply({
          content: "message 必须是当前 DLC Thread 内的一条具体 Discord Message Link。",
          ephemeral: true,
        });
        return;
      }

      const sourceMessage = await channel.messages.fetch(parsed.messageId);
      const jsonAttachments = [...sourceMessage.attachments.values()].filter(
        isJsonAttachment,
      );

      if (jsonAttachments.length === 0) {
        await interaction.reply({
          content: "这条消息没有可识别的 JSON 附件，所以不会登记为 release。",
          ephemeral: true,
        });
        return;
      }

      const release = await releaseStore.recordRelease({
        threadId: interaction.channelId,
        guildId: interaction.guildId,
        forumId: channel.parentId ?? "",
        version,
        messageUrl,
        messageId: sourceMessage.id,
        publisherId: interaction.user.id,
        sourceAuthorId: sourceMessage.author.id,
        createdAt: new Date().toISOString(),
      });

      await interaction.reply({
        content:
          "✅ 已登记 **" +
          release.version +
          "** 为当前 DLC 的最新版\n" +
          release.messageUrl +
          "\nJSON 附件：" +
          jsonAttachments.length +
          " 个",
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "latest") {
      const latest = await releaseStore.getLatestRelease(interaction.channelId);

      if (!latest) {
        await interaction.reply({
          content: "这个 DLC 还没有登记过 release。",
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content:
          "🐕 **Latest: " +
          latest.version +
          "**\n" +
          latest.messageUrl +
          "\n登记时间：" +
          latest.createdAt,
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error("Slash command failed:", error);

    const payload = {
      content: "Helpful Doggy 命令执行失败：" + (error?.message || "unknown error"),
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, {
      ok: true,
      discordReady: discordClient.isReady(),
      commandsReady,
    });
  }

  if (req.method !== "POST" || req.url !== "/api/resolve") {
    return sendJson(res, 404, { error: "not_found" });
  }

  try {
    const body = await readJsonBody(req);
    const result = await resolveMessage(body.messageUrl);
    return sendJson(res, result.status, result.body);
  } catch (error) {
    console.error(error);

    if (error?.status === 403) {
      return sendJson(res, 403, { error: "discord_forbidden" });
    }

    if (error?.status === 404) {
      return sendJson(res, 404, { error: "discord_not_found" });
    }

    return sendJson(res, 500, { error: "internal_error" });
  }
});

server.listen(port, host, () => {
  const shownHost = host === "0.0.0.0" ? "<this-PC-LAN-IP>" : host;
  console.log(
    "Helpful Doggy bridge listening on http://" + shownHost + ":" + port,
  );
});

discordClient.login(token).catch((error) => {
  console.error("Discord login failed:", error);
  process.exitCode = 1;
});
