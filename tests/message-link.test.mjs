import test from "node:test";
import assert from "node:assert/strict";
import { parseDiscordMessageLink } from "../bridge/message-link.mjs";

test("parses a Discord message link", () => {
  assert.deepEqual(
    parseDiscordMessageLink("https://discord.com/channels/111/222/333"),
    { guildId: "111", channelId: "222", messageId: "333", kind: "message" },
  );
});

test("parses a Discord thread link", () => {
  assert.deepEqual(
    parseDiscordMessageLink("https://discord.com/channels/111/222"),
    { guildId: "111", channelId: "222", messageId: null, kind: "thread" },
  );
});

test("accepts canary links and query strings", () => {
  assert.deepEqual(
    parseDiscordMessageLink("https://canary.discord.com/channels/111/222/333?jump=1"),
    { guildId: "111", channelId: "222", messageId: "333", kind: "message" },
  );
});

test("rejects non-Discord or malformed links", () => {
  assert.equal(parseDiscordMessageLink("https://example.com/channels/111/222/333"), null);
  assert.equal(parseDiscordMessageLink("https://discord.com/channels/111"), null);
  assert.equal(parseDiscordMessageLink("https://discord.com/channels/abc/222"), null);
});
