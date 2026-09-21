const MESSAGE_LINK_RE = /^https:\/\/(?:www\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?(?:\?.*)?$/i;

export function parseDiscordMessageLink(value) {
  const match = MESSAGE_LINK_RE.exec(String(value ?? "").trim());
  if (!match) return null;
  return { guildId: match[1], channelId: match[2], messageId: match[3] };
}
