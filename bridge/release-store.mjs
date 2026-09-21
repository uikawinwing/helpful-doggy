import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const SCHEMA_VERSION = 1;

function emptyStore() {
  return { schemaVersion: SCHEMA_VERSION, threads: {} };
}

export function makePackageKey(guildId, threadId) {
  return String(guildId) + ":" + String(threadId);
}

export class ReleaseStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.writeQueue = Promise.resolve();
  }

  async read() {
    try {
      const text = await readFile(this.filePath, "utf8");
      const data = JSON.parse(text);

      if (!data || typeof data !== "object" || data.schemaVersion !== SCHEMA_VERSION) {
        throw new Error("Unsupported release store schema.");
      }

      if (!data.threads || typeof data.threads !== "object") {
        data.threads = {};
      }

      return data;
    } catch (error) {
      if (error?.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async recordRelease(release) {
    return this.#enqueue(async () => {
      const data = await this.read();
      const threadId = String(release.threadId);
      const guildId = String(release.guildId);
      const current = data.threads[threadId] ?? {
        guildId,
        forumId: String(release.forumId ?? ""),
        packageKey: makePackageKey(guildId, threadId),
        releases: [],
      };

      current.guildId = guildId;
      current.forumId = String(release.forumId ?? current.forumId ?? "");
      current.packageKey = makePackageKey(guildId, threadId);
      current.releases = Array.isArray(current.releases) ? current.releases : [];

      current.releases = current.releases.filter(
        (item) => String(item.version) !== String(release.version),
      );

      current.releases.push({
        version: String(release.version),
        messageUrl: String(release.messageUrl),
        messageId: String(release.messageId),
        publisherId: String(release.publisherId),
        sourceAuthorId: String(release.sourceAuthorId ?? ""),
        createdAt: String(release.createdAt ?? new Date().toISOString()),
      });

      data.threads[threadId] = current;
      await this.#writeAtomic(data);
      return {
        ...current.releases.at(-1),
        packageKey: current.packageKey,
        threadId,
        guildId,
      };
    });
  }

  async getPackage(threadId) {
    const data = await this.read();
    const item = data.threads[String(threadId)];
    if (!item) return null;

    return {
      ...item,
      packageKey: item.packageKey ?? makePackageKey(item.guildId, threadId),
      threadId: String(threadId),
    };
  }

  async getLatestRelease(threadId) {
    const pkg = await this.getPackage(threadId);
    const releases = pkg?.releases;
    if (!Array.isArray(releases) || releases.length === 0) return null;

    return {
      ...releases.at(-1),
      packageKey: pkg.packageKey,
      threadId: pkg.threadId,
      guildId: pkg.guildId,
    };
  }

  async getReleaseByMessage(threadId, messageId) {
    const pkg = await this.getPackage(threadId);
    const releases = pkg?.releases;
    if (!Array.isArray(releases)) return null;

    const release = [...releases]
      .reverse()
      .find((item) => String(item.messageId) === String(messageId));

    if (!release) return null;

    return {
      ...release,
      packageKey: pkg.packageKey,
      threadId: pkg.threadId,
      guildId: pkg.guildId,
    };
  }

  async listReleases(threadId) {
    const pkg = await this.getPackage(threadId);
    return Array.isArray(pkg?.releases) ? [...pkg.releases] : [];
  }

  #enqueue(task) {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.catch(() => {});
    return run;
  }

  async #writeAtomic(data) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = this.filePath + ".tmp";
    await writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(tempPath, this.filePath);
  }
}
