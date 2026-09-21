import { importWorldInfo } from "/scripts/world-info.js";
import { SCRIPT_TYPES, getScriptsByType, saveScriptsByType } from "/scripts/extensions/regex/engine.js";

const DEFAULT_BRIDGE_URL = "http://127.0.0.1:3210";

function classifyJson(data) {
  if (data && !Array.isArray(data) && typeof data === "object" && data.entries && typeof data.entries === "object") return "worldbook";
  const scripts = Array.isArray(data) ? data : [data];
  if (scripts.length > 0 && scripts.every((item) => item && typeof item === "object" && typeof item.scriptName === "string" && typeof item.findRegex === "string")) return "regex";
  return "unknown";
}

function makeFile(filename, text) {
  return new File([text], filename, { type: "application/json" });
}

async function installWorldbook(attachment) {
  await importWorldInfo(makeFile(attachment.filename, attachment.text));
}

async function installGlobalRegex(attachment) {
  const parsed = JSON.parse(attachment.text);
  const incoming = Array.isArray(parsed) ? parsed : [parsed];
  const current = [...getScriptsByType(SCRIPT_TYPES.GLOBAL)];
  for (const script of incoming) {
    current.push({
      ...script,
      id: globalThis.crypto?.randomUUID?.() ?? ("helpful-doggy-" + Date.now() + "-" + Math.random()),
    });
  }
  await saveScriptsByType(current, SCRIPT_TYPES.GLOBAL);
}

async function resolveMessage(bridgeUrl, messageUrl) {
  const response = await fetch(bridgeUrl.replace(/\/$/, "") + "/api/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageUrl }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || ("Bridge returned HTTP " + response.status));
  return data;
}

function renderResults(container, rows) {
  container.innerHTML = "";
  for (const row of rows) {
    const line = document.createElement("div");
    line.className = "helpful-doggy-result";
    line.textContent = (row.ok ? "✅ " : "⚠️ ") + row.filename + " — " + row.message;
    container.appendChild(line);
  }
}

async function runInstall(root) {
  const bridgeUrl = root.querySelector("#helpful-doggy-bridge-url").value.trim();
  const messageUrl = root.querySelector("#helpful-doggy-message-url").value.trim();
  const button = root.querySelector("#helpful-doggy-install");
  const results = root.querySelector("#helpful-doggy-results");

  if (!messageUrl) {
    renderResults(results, [{ ok: false, filename: "Discord", message: "请粘贴消息链接" }]);
    return;
  }

  button.disabled = true;
  button.textContent = "处理中…";
  try {
    const resolved = await resolveMessage(bridgeUrl || DEFAULT_BRIDGE_URL, messageUrl);
    const ready = (resolved.attachments ?? []).filter((item) => item.status === "ready");
    if (ready.length === 0) {
      renderResults(results, [{ ok: false, filename: "附件", message: "没有可安装的 JSON 附件" }]);
      return;
    }

    const rows = [];
    for (const attachment of ready) {
      try {
        const parsed = JSON.parse(attachment.text);
        const type = classifyJson(parsed);
        if (type === "worldbook") {
          await installWorldbook(attachment);
          rows.push({ ok: true, filename: attachment.filename, message: "Worldbook 已导入" });
        } else if (type === "regex") {
          await installGlobalRegex(attachment);
          rows.push({ ok: true, filename: attachment.filename, message: "Global Regex 已导入" });
        } else {
          rows.push({ ok: false, filename: attachment.filename, message: "JSON 类型暂未识别，未安装" });
        }
      } catch (error) {
        rows.push({ ok: false, filename: attachment.filename, message: error?.message || "安装失败" });
      }
    }
    renderResults(results, rows);
  } catch (error) {
    renderResults(results, [{ ok: false, filename: "Bridge", message: error?.message || "连接失败" }]);
  } finally {
    button.disabled = false;
    button.textContent = "识别并安装";
  }
}

function createSettingsPanel() {
  const root = document.createElement("div");
  root.id = "helpful-doggy-settings";
  root.className = "helpful-doggy-card";
  root.innerHTML = [
    '<div class="helpful-doggy-title">🐕 Helpful Doggy</div>',
    '<div class="helpful-doggy-note">粘贴私服 Discord DLC 消息链接。Prototype 仅自动安装 Worldbook 与 Global Regex。</div>',
    '<label>Bridge URL<input id="helpful-doggy-bridge-url" class="text_pole" value="' + DEFAULT_BRIDGE_URL + '" /></label>',
    '<label>Discord Message Link<input id="helpful-doggy-message-url" class="text_pole" placeholder="https://discord.com/channels/..." /></label>',
    '<button id="helpful-doggy-install" class="menu_button">识别并安装</button>',
    '<div id="helpful-doggy-results"></div>',
  ].join("");
  root.querySelector("#helpful-doggy-install").addEventListener("click", () => runInstall(root));
  return root;
}

jQuery(async () => {
  const host = document.querySelector("#extensions_settings2") ?? document.querySelector("#extensions_settings");
  if (!host) {
    console.error("Helpful Doggy: extension settings container not found.");
    return;
  }
  host.appendChild(createSettingsPanel());
});
