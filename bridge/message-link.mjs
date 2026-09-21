const ALLOWED_HOSTS = new Set([
  "discord.com",
  "www.discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
  "www.discordapp.com",
]);

export function parseDiscordMessageLink(value) {
  let url;
  try {
    url = new URL(String(value ?? "").trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "channels" || (parts.length !== 3 && parts.length !== 4)) {
    return null;
  }

  const [, guildId, channelId, messageId] = parts;
  if (![guildId, channelId, messageId].filter(Boolean).every((id) => /^\d+$/.test(id))) {
    return null;
  }

  return {
    guildId,
    channelId,
    messageId: messageId ?? null,
    kind: messageId ? "message" : "thread",
  };
}
