import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ReleaseStore, makePackageKey } from "../bridge/release-store.mjs";

test("records and returns the latest release per thread", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "helpful-doggy-"));
  const file = path.join(dir, "releases.json");
  const store = new ReleaseStore(file);

  try {
    await store.recordRelease({
      threadId: "thread-1",
      guildId: "guild-1",
      forumId: "forum-1",
      version: "1.0.0",
      messageUrl: "https://discord.com/channels/1/2/3",
      messageId: "3",
      publisherId: "user-1",
      sourceAuthorId: "user-1",
      createdAt: "2026-09-21T10:00:00.000Z",
    });

    await store.recordRelease({
      threadId: "thread-1",
      guildId: "guild-1",
      forumId: "forum-1",
      version: "1.1.0",
      messageUrl: "https://discord.com/channels/1/2/4",
      messageId: "4",
      publisherId: "user-1",
      sourceAuthorId: "user-1",
      createdAt: "2026-09-21T10:10:00.000Z",
    });

    const latest = await store.getLatestRelease("thread-1");
    assert.equal(latest.version, "1.1.0");
    assert.equal(latest.messageId, "4");

    const persisted = JSON.parse(await readFile(file, "utf8"));
    assert.equal(persisted.schemaVersion, 1);
    assert.equal(persisted.threads["thread-1"].releases.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-registering the same version replaces it and makes it latest", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "helpful-doggy-"));
  const file = path.join(dir, "releases.json");
  const store = new ReleaseStore(file);

  try {
    await store.recordRelease({
      threadId: "thread-1",
      guildId: "guild-1",
      forumId: "forum-1",
      version: "1.0.0",
      messageUrl: "https://discord.com/channels/1/2/3",
      messageId: "3",
      publisherId: "user-1",
    });

    await store.recordRelease({
      threadId: "thread-1",
      guildId: "guild-1",
      forumId: "forum-1",
      version: "1.1.0",
      messageUrl: "https://discord.com/channels/1/2/4",
      messageId: "4",
      publisherId: "user-1",
    });

    await store.recordRelease({
      threadId: "thread-1",
      guildId: "guild-1",
      forumId: "forum-1",
      version: "1.0.0",
      messageUrl: "https://discord.com/channels/1/2/5",
      messageId: "5",
      publisherId: "user-1",
    });

    const releases = await store.listReleases("thread-1");
    assert.deepEqual(
      releases.map((item) => [item.version, item.messageId]),
      [
        ["1.1.0", "4"],
        ["1.0.0", "5"],
      ],
    );
    assert.equal((await store.getLatestRelease("thread-1")).messageId, "5");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});


test("package identity is guild id plus thread id", () => {
  assert.equal(makePackageKey("guild-1", "thread-1"), "guild-1:thread-1");
});

test("finds a registered release by source message", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "helpful-doggy-"));
  const file = path.join(dir, "releases.json");
  const store = new ReleaseStore(file);

  try {
    await store.recordRelease({
      threadId: "thread-7",
      guildId: "guild-9",
      forumId: "forum-2",
      version: "2.0.0",
      messageUrl: "https://discord.com/channels/9/7/42",
      messageId: "42",
      publisherId: "user-1",
    });

    const release = await store.getReleaseByMessage("thread-7", "42");
    assert.equal(release.version, "2.0.0");
    assert.equal(release.packageKey, "guild-9:thread-7");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
