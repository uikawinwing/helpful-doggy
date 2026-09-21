import http from "node:http";
import { parseDiscordMessageLink } from "./message-link.mjs";

const token = process.env.DISCORD_BOT_TOKEN?.trim();
const targetGuildId = process.env.TARGET_GUILD_ID?.trim();
const allowedChannelIds = new Set((process.env.ALLOWED_CHANNEL_IDS ?? "").split(",").map((v) => v.trim()).filter(Boolean));
const port = Number(process.env.PORT || 3210);
const maxAttachmentBytes = Number(process.env.MAX_ATTACHMENT_BYTES || 5 * 1024 * 1024);
const DISCORD_API = "https://discord.com/api/v10";

if (!token || !targetGuildId || allowedChannelIds.size === 0) {
  console.error("Missing DISCORD_BOT_TOKEN, TARGET_GUILD_ID, or ALLOWED_CHANNEL_IDS.");
  process.exit(1);
}

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
    const error = new Error("Discord API " + response.status + ": " + text.slice(0, 300));
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

function isJsonAttachment(attachment) {
  const filename = String(attachment.filename ?? "").toLowerCase();
  const contentType = String(attachment.content_type ?? "").toLowerCase();
  return filename.endsWith(".json") || contentType.includes("application/json");
}

async function downloadJsonAttachment(attachment) {
  const base = {
    id: attachment.id, filename: attachment.filename, size: attachment.size,
    contentType: attachment.content_type ?? null,
  };
  if (!isJsonAttachment(attachment)) return { ...base, status: "ignored", reason: "not-json" };
  if (Number(attachment.size ?? 0) > maxAttachmentBytes) return { ...base, status: "ignored", reason: "too-large" };

  const response = await fetch(attachment.url);
  if (!response.ok) return { ...base, status: "error", reason: "download-" + response.status };

  const text = await response.text();
  try { JSON.parse(text); } catch { return { ...base, status: "error", reason: "invalid-json" }; }
  return { ...base, status: "ready", text };
}

async function resolveMessage(messageUrl) {
  const parsed = parseDiscordMessageLink(messageUrl);
  if (!parsed) return { status: 400, body: { error: "invalid_message_url" } };
  if (parsed.guildId !== targetGuildId) return { status: 403, body: { error: "guild_not_allowed" } };

  const channel = await discordGet("/channels/" + parsed.channelId);
  if (!isAllowedDiscordChannel(channel)) return { status: 403, body: { error: "channel_not_allowed" } };

  const message = await discordGet("/channels/" + parsed.channelId + "/messages/" + parsed.messageId);
  const attachments = await Promise.all((message.attachments ?? []).map(downloadJsonAttachment));

  return {
    status: 200,
    body: {
      message: {
        id: message.id, channelId: parsed.channelId, guildId: parsed.guildId,
        author: { id: message.author?.id ?? null, username: message.author?.username ?? null },
        content: message.content ?? "", timestamp: message.timestamp ?? null,
      },
      attachments,
    },
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    return res.end();
  }

  if (req.method === "GET" && req.url === "/health") return sendJson(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/api/resolve") return sendJson(res, 404, { error: "not_found" });

  try {
    const body = await readJsonBody(req);
    const result = await resolveMessage(body.messageUrl);
    return sendJson(res, result.status, result.body);
  } catch (error) {
    console.error(error);
    if (error?.status === 403) return sendJson(res, 403, { error: "discord_forbidden" });
    if (error?.status === 404) return sendJson(res, 404, { error: "discord_not_found" });
    return sendJson(res, 500, { error: "internal_error" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log("Helpful Doggy bridge listening on http://127.0.0.1:" + port);
});
