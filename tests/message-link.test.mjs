import test from "node:test";
import assert from "node:assert/strict";
import { parseDiscordMessageLink } from "../bridge/message-link.mjs";

test("parses a Discord message link", () => {
  assert.deepEqual(parseDiscordMessageLink("https://discord.com/channels/111/222/333"), { guildId: "111", channelId: "222", messageId: "333" });
});

test("rejects non-message links", () => {
  assert.equal(parseDiscordMessageLink("https://discord.com/channels/111/222"), null);
  assert.equal(parseDiscordMessageLink("https://example.com/channels/111/222/333"), null);
});
