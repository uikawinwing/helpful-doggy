import {
  createNewWorldInfo,
  createWorldInfoEntry,
  getFreeWorldEntryUid,
  loadWorldInfo,
  saveWorldInfo,
  world_names,
} from "/scripts/world-info.js";
import {
  SCRIPT_TYPES,
  getScriptsByType,
  saveScriptsByType,
} from "/scripts/extensions/regex/engine.js";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:3210";
const REGISTRY_BOOK_NAME = "[Helpful Doggy] Registry";
const DLC_BOOK_NAME = "[Helpful Doggy] DLC";
const REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_KIND = "helpful-doggy-package";

function classifyJson(data) {
  if (
    data &&
    !Array.isArray(data) &&
    typeof data === "object" &&
    data.entries &&
    typeof data.entries === "object"
  ) {
    return "worldbook";
  }

  const scripts = Array.isArray(data) ? data : [data];
  if (
    scripts.length > 0 &&
    scripts.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.scriptName === "string" &&
        typeof item.findRegex === "string",
    )
  ) {
    return "regex";
  }

  return "unknown";
}

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function hasEntry(data, uid) {
  return Object.prototype.hasOwnProperty.call(data.entries ?? {}, String(uid));
}

async function ensureWorldBook(name) {
  let data = await loadWorldInfo(name);
  if (data?.entries && typeof data.entries === "object") return data;

  if (Array.isArray(world_names) && world_names.includes(name)) {
    throw new Error("无法读取已有 Lorebook：" + name);
  }

  const created = await createNewWorldInfo(name);
  if (!created) throw new Error("无法创建 Lorebook：" + name);

  data = await loadWorldInfo(name);
  if (!data?.entries || typeof data.entries !== "object") {
    throw new Error("创建后仍无法读取 Lorebook：" + name);
  }

  return data;
}

function parseRegistryEntry(entry) {
  if (!entry || typeof entry.content !== "string") return null;

  try {
    const value = JSON.parse(entry.content);
    if (
      value?.kind === REGISTRY_KIND &&
      value?.schemaVersion === REGISTRY_SCHEMA_VERSION &&
      typeof value.packageKey === "string"
    ) {
      return value;
    }
  } catch {
    // Registry lorebook may contain unrelated disabled entries.
  }

  return null;
}

async function loadPackageRegistry(packageMeta) {
  const registryData = await ensureWorldBook(REGISTRY_BOOK_NAME);

  for (const entry of Object.values(registryData.entries)) {
    const record = parseRegistryEntry(entry);
    if (record?.packageKey === packageMeta.key) {
      record.assets ??= {};
      record.assets.worldbook ??= {};
      record.assets.regex ??= {};
      return { registryData, entry, record };
    }
  }

  const entry = createWorldInfoEntry(REGISTRY_BOOK_NAME, registryData);
  if (!entry) throw new Error("无法创建 Helpful Doggy registry entry");

  const record = {
    kind: REGISTRY_KIND,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    packageKey: packageMeta.key,
    guildId: packageMeta.guildId,
    threadId: packageMeta.threadId,
    version: null,
    sourceMessageId: null,
    assets: {
      worldbook: {},
      regex: {},
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  Object.assign(entry, {
    comment: "[Helpful Doggy] " + packageMeta.threadId,
    content: JSON.stringify(record, null, 2),
    disable: true,
    constant: false,
    key: [],
    keysecondary: [],
  });

  await saveWorldInfo(REGISTRY_BOOK_NAME, registryData, true);
  return { registryData, entry, record };
}

async function savePackageRegistry(state) {
  state.record.updatedAt = new Date().toISOString();
  Object.assign(state.entry, {
    comment: "[Helpful Doggy] " + state.record.threadId,
    content: JSON.stringify(state.record, null, 2),
    disable: true,
    constant: false,
    key: [],
    keysecondary: [],
  });
  await saveWorldInfo(REGISTRY_BOOK_NAME, state.registryData, true);
}

function worldbookAssetKey(attachment, sourceEntryKey, sourceEntry) {
  const sourceUid = sourceEntry?.uid ?? sourceEntryKey;
  return attachment.filename + "::" + String(sourceUid);
}

async function installManagedWorldbooks(items, registryState) {
  if (items.length === 0) return { added: 0, updated: 0 };

  const targetData = await ensureWorldBook(DLC_BOOK_NAME);
  const mappings = registryState.record.assets.worldbook;
  let added = 0;
  let updated = 0;

  for (const item of items) {
    for (const [sourceEntryKey, sourceEntry] of Object.entries(item.data.entries)) {
      const assetKey = worldbookAssetKey(item.attachment, sourceEntryKey, sourceEntry);
      const mapped = mappings[assetKey];
      let targetUid = Number(mapped?.targetUid);

      if (!Number.isInteger(targetUid) || !hasEntry(targetData, targetUid)) {
        targetUid = getFreeWorldEntryUid(targetData);
        if (!Number.isInteger(targetUid)) {
          throw new Error("无法分配 Worldbook UID");
        }
        added++;
      } else {
        updated++;
      }

      const nextEntry = clone(sourceEntry);
      nextEntry.uid = targetUid;
      targetData.entries[targetUid] = nextEntry;

      mappings[assetKey] = {
        targetBook: DLC_BOOK_NAME,
        targetUid,
        filename: item.attachment.filename,
        sourceUid: String(sourceEntry?.uid ?? sourceEntryKey),
      };
    }
  }

  await saveWorldInfo(DLC_BOOK_NAME, targetData, true);
  await savePackageRegistry(registryState);

  return { added, updated };
}

function regexSourceKey(attachment, script, index) {
  if (script?.id) return "id:" + String(script.id);
  if (script?.scriptName) {
    return "name:" + attachment.filename + "::" + String(script.scriptName);
  }
  return "index:" + attachment.filename + "::" + index;
}

function newLocalRegexId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    "helpful-doggy-" + Date.now() + "-" + Math.random()
  );
}

async function installManagedRegex(items, registryState) {
  if (items.length === 0) return { added: 0, updated: 0 };

  const current = [...getScriptsByType(SCRIPT_TYPES.GLOBAL)];
  const mappings = registryState.record.assets.regex;
  let added = 0;
  let updated = 0;

  for (const item of items) {
    const scripts = Array.isArray(item.data) ? item.data : [item.data];

    scripts.forEach((script, index) => {
      const sourceKey = regexSourceKey(item.attachment, script, index);
      const mapped = mappings[sourceKey];
      const localId = mapped?.localId || newLocalRegexId();
      const existingIndex = current.findIndex(
        (candidate) => String(candidate?.id) === String(localId),
      );

      const nextScript = {
        ...clone(script),
        id: localId,
      };

      if (existingIndex >= 0) {
        current[existingIndex] = nextScript;
        updated++;
      } else {
        current.push(nextScript);
        added++;
      }

      mappings[sourceKey] = {
        localId,
        filename: item.attachment.filename,
        sourceId: script?.id ? String(script.id) : null,
        scriptName: script?.scriptName ?? "",
      };
    });
  }

  await saveScriptsByType(current, SCRIPT_TYPES.GLOBAL);
  await savePackageRegistry(registryState);

  return { added, updated };
}

async function resolveMessage(bridgeUrl, messageUrl) {
  const response = await fetch(
    bridgeUrl.replace(/\/$/, "") + "/api/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageUrl }),
    },
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Bridge returned HTTP " + response.status);
  }

  return data;
}

function renderResults(container, rows) {
  container.innerHTML = "";

  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "helpful-doggy-result";
    line.textContent =
      (row.ok ? "✅ " : "⚠️ ") + row.filename + " — " + row.message;
    container.appendChild(line);
  }
}

async function runInstall(root) {
  const bridgeUrl = root
    .querySelector("#helpful-doggy-bridge-url")
    .value.trim();
  const messageUrl = root
    .querySelector("#helpful-doggy-message-url")
    .value.trim();
  const button = root.querySelector("#helpful-doggy-install");
  const results = root.querySelector("#helpful-doggy-results");

  if (!messageUrl) {
    renderResults(results, [
      { ok: false, filename: "Discord", message: "请粘贴帖子或消息链接" },
    ]);
    return;
  }

  button.disabled = true;
  button.textContent = "处理中…";

  try {
    const resolved = await resolveMessage(
      bridgeUrl || DEFAULT_BRIDGE_URL,
      messageUrl,
    );

    if (!resolved.package?.key) {
      throw new Error("这个链接不属于 Discord Thread，无法建立 DLC package identity");
    }

    const ready = (resolved.attachments ?? []).filter(
      (item) => item.status === "ready",
    );

    if (ready.length === 0) {
      renderResults(results, [
        { ok: false, filename: "附件", message: "没有可安装的 JSON 附件" },
      ]);
      return;
    }

    const parsedItems = ready.map((attachment) => {
      const data = JSON.parse(attachment.text);
      return {
        attachment,
        data,
        type: classifyJson(data),
      };
    });

    const worldbooks = parsedItems.filter((item) => item.type === "worldbook");
    const regexes = parsedItems.filter((item) => item.type === "regex");
    const unknown = parsedItems.filter((item) => item.type === "unknown");

    if (worldbooks.length === 0 && regexes.length === 0) {
      renderResults(
        results,
        unknown.map((item) => ({
          ok: false,
          filename: item.attachment.filename,
          message: "JSON 类型暂未识别，未安装",
        })),
      );
      return;
    }

    const registryState = await loadPackageRegistry(resolved.package);
    const previousVersion = registryState.record.version;
    const rows = [];
    let failed = false;

    if (worldbooks.length > 0) {
      try {
        const stats = await installManagedWorldbooks(worldbooks, registryState);
        rows.push({
          ok: true,
          filename: DLC_BOOK_NAME,
          message:
            "Worldbook 更新 " +
            stats.updated +
            " 项，新增 " +
            stats.added +
            " 项",
        });
      } catch (error) {
        failed = true;
        rows.push({
          ok: false,
          filename: "Worldbook",
          message: error?.message || "更新失败",
        });
      }
    }

    if (regexes.length > 0) {
      try {
        const stats = await installManagedRegex(regexes, registryState);
        rows.push({
          ok: true,
          filename: "Global Regex",
          message:
            "Regex 更新 " +
            stats.updated +
            " 项，新增 " +
            stats.added +
            " 项",
        });
      } catch (error) {
        failed = true;
        rows.push({
          ok: false,
          filename: "Regex",
          message: error?.message || "更新失败",
        });
      }
    }

    for (const item of unknown) {
      rows.push({
        ok: false,
        filename: item.attachment.filename,
        message: "JSON 类型暂未识别，未安装",
      });
    }

    if (!failed) {
      registryState.record.guildId = resolved.package.guildId;
      registryState.record.threadId = resolved.package.threadId;
      registryState.record.packageKey = resolved.package.key;
      registryState.record.version = resolved.package.version;
      registryState.record.sourceMessageId = resolved.message?.id ?? null;
      await savePackageRegistry(registryState);

      rows.unshift({
        ok: true,
        filename: "Package",
        message:
          (previousVersion
            ? "更新 " + previousVersion + " → "
            : "首次安装 ") +
          (resolved.package.version ?? "未登记版本") +
          " · " +
          resolved.package.key,
      });
    } else {
      rows.unshift({
        ok: false,
        filename: "Package",
        message: "部分安装失败，版本号未更新；已成功写入的项目仍保留 registry 映射",
      });
    }

    renderResults(results, rows);
  } catch (error) {
    renderResults(results, [
      {
        ok: false,
        filename: "Helpful Doggy",
        message: error?.message || "连接失败",
      },
    ]);
  } finally {
    button.disabled = false;
    button.textContent = "识别并安装 / 更新";
  }
}

function createSettingsPanel() {
  const root = document.createElement("div");
  root.id = "helpful-doggy-settings";
  root.className = "helpful-doggy-card";
  root.innerHTML = [
    '<div class="helpful-doggy-title">🐕 Helpful Doggy</div>',
    '<div class="helpful-doggy-note">Discord Thread 自动作为 DLC ID。Worldbook 写入 [Helpful Doggy] DLC；安装状态写入 disabled 的 [Helpful Doggy] Registry。</div>',
    '<label>Bridge URL<input id="helpful-doggy-bridge-url" class="text_pole" value="' +
      DEFAULT_BRIDGE_URL +
      '" /></label>',
    '<label>Discord Thread / Message Link<input id="helpful-doggy-message-url" class="text_pole" placeholder="https://discord.com/channels/..." /></label>',
    '<button id="helpful-doggy-install" class="menu_button">识别并安装 / 更新</button>',
    '<div id="helpful-doggy-results"></div>',
  ].join("");

  root
    .querySelector("#helpful-doggy-install")
    .addEventListener("click", () => runInstall(root));
  return root;
}

jQuery(async () => {
  const host =
    document.querySelector("#extensions_settings2") ??
    document.querySelector("#extensions_settings");

  if (!host) {
    console.error("Helpful Doggy: extension settings container not found.");
    return;
  }

  host.appendChild(createSettingsPanel());
});
