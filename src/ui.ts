import {
  config,
  diff,
  type Config,
  type Monitor,
  type Snapshot,
  type ChangeEvent,
  type Job,
} from "./core";
import { send } from "./messages";
const app = document.querySelector("#app")!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (label: string, fn: () => unknown) => {
  const b = el("button", label);
  b.onclick = () => {
    try {
      void Promise.resolve(fn()).catch(error);
    } catch (e) {
      error(e);
    }
  };
  return b;
};
const message = el("p");
message.setAttribute("role", "status");
function error(e: unknown) {
  message.textContent = "錯誤：" + (e instanceof Error ? e.message : String(e));
  message.className = "error";
}
const time = (v?: number) => (v ? new Date(v).toLocaleString() : "—");
let state: any;
let editing = false;
const health: Record<string, string> = {
  initializing: "建立基準中",
  healthy: "監控中",
  retrying: "重試中",
  needs_permission: "需要重新授權",
  needs_attention: "需要處理",
};
async function refresh() {
  state = await send({ type: "STATE" });
  if (document.body.dataset.page === "popup") return popup();
  if (!editing) dashboard();
}
function popup() {
  app.replaceChildren(el("h1", "DOM 區域監控"), message);
  const ms = state.monitors as Monitor[],
    es = state.events as ChangeEvent[];
  app.append(
    el(
      "p",
      `監控中 ${ms.filter((m) => m.enabled && m.health === "healthy").length} · 錯誤 ${ms.filter((m) => m.lastError || m.health === "needs_permission").length} · 未讀 ${es.filter((e) => !e.readAt).length}`,
    ),
    button("監控目前頁面", async () => {
      await send({ type: "START_PICKER" });
      window.close();
    }),
    button("開啟管理頁", () =>
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }),
    ),
  );
}
function dashboard() {
  app.replaceChildren(el("h1", "DOM 區域監控"), message);
  const controls = el("nav");
  controls.append(
    button("新增任務", () => form()),
    button("重新整理", refresh),
    button("資料管理", dataPage),
  );
  app.append(
    controls,
    el(
      "p",
      "比較文字、連結及圖片網址，不比對截圖。背景分頁可見於分頁列；檢查時間可能延後。",
    ),
  );
  for (const m of state.monitors as Monitor[]) {
    const card = el("article");
    const j = (state.jobs as Job[]).find(
      (j) =>
        j.monitorId === m.id &&
        !["finished", "cancelled", "failed"].includes(j.phase),
    );
    card.append(
      el("h2", m.name),
      el("p", m.origin),
      el(
        "p",
        `${!m.enabled ? "暫停" : j ? "檢查中 · " + j.phase : health[m.health] || m.health}${!j && m.enabled && m.nextDueAt <= Date.now() ? " · 佇列等待" : ""} · 連續錯誤 ${m.consecutiveFailures}`,
      ),
      el(
        "p",
        `最近嘗試 ${time(m.lastAttemptAt)}／成功 ${time(m.lastSuccessAt)}／變更 ${time(m.lastChangeAt)}／下次 ${time(m.nextDueAt)}`,
      ),
    );
    if (j && Date.now() > j.deadlineAt)
      card.append(el("p", "工作已逾時，等待 dispatcher 清理。"));
    if (m.lastError)
      card.append(
        el(
          "p",
          `${m.lastError.code}：${m.lastError.userMessage} · 診斷 ${m.lastError.diagnosticId}`,
        ),
      );
    const run = button("立即檢查", async () => {
      await send({ type: "RUN_NOW", id: m.id });
      await refresh();
    });
    run.disabled = !!j;
    card.append(
      run,
      button(m.enabled ? "暫停" : "恢復", async () => {
        await send({
          type: m.enabled ? "PAUSE_MONITOR" : "RESUME_MONITOR",
          id: m.id,
        });
        await refresh();
      }),
      button("編輯", () => form(m)),
      button("開啟網站", () => chrome.tabs.create({ url: m.url })),
      button("歷史", () => history(m.id)),
      button("重新設定基準", async () => {
        if (confirm("將以新快照建立基準，不產生變更事件。確定？")) {
          await send({ type: "RESET_BASELINE", id: m.id });
          await refresh();
        }
      }),
      button("刪除", async () => {
        if (confirm("刪除此任務及所有歷史？")) {
          await send({ type: "DELETE_MONITOR", id: m.id });
          await refresh();
        }
      }),
    );
    if (m.health === "needs_permission")
      card.append(
        button("重新授權", async () => {
          if (
            await chrome.permissions.request({ origins: [m.origin + "/*"] })
          ) {
            await send({ type: "RESUME_MONITOR", id: m.id });
            await refresh();
          }
        }),
      );
    app.append(card);
  }
  if (!state.monitors.length)
    app.append(
      el("p", "尚無任務。先在目標網頁點擊擴充功能，選擇「監控目前頁面」。"),
    );
  const failed = state.outbox.filter((o: any) => o.state === "failed");
  if (failed.length)
    app.append(
      el(
        "p",
        `通知有 ${failed.length} 筆未成功提交或已停用。事件仍保留；API 成功也不代表 OS 已顯示。`,
      ),
    );
  if (
    (state.jobs as Job[]).some((j) =>
      ["WORKER_INTERRUPTED", "LOAD_TIMEOUT", "REDIRECTED_ORIGIN"].includes(
        j.error || "",
      ),
    )
  )
    app.append(
      el(
        "p",
        "曾有工作中斷；無法證明所有權的背景分頁會保留，可能需要手動關閉。",
      ),
    );
  const hash = decodeURIComponent(location.hash);
  if (hash === "#new") {
    location.hash = "";
    form(state.monitors.find((m: Monitor) => m.id === state.draft?.monitorId));
  } else if (hash.startsWith("#event=")) {
    location.hash = "";
    const e = state.events.find(
      (e: ChangeEvent) =>
        e.id === new URLSearchParams(hash.slice(1)).get("event"),
    );
    if (e) history(e.monitorId, e.id);
    else {
      const monitorId = new URLSearchParams(hash.slice(1)).get("monitor");
      if (monitorId && state.monitors.some((m: Monitor) => m.id === monitorId))
        history(monitorId);
      message.textContent = "事件已被清理，已顯示仍保留的任務紀錄。";
    }
  }
}
function form(m?: Monitor) {
  editing = true;
  app.replaceChildren(el("h1", m ? "編輯任務" : "新增任務"), message);
  const f = el("form");
  const draft = state.draft;
  const source: Partial<Monitor> &
    Pick<
      Config,
      | "name"
      | "url"
      | "selector"
      | "ignoreSelectors"
      | "captureOptions"
      | "intervalMinutes"
      | "settleDelayMs"
      | "allowEmpty"
      | "notifications"
    > = (m
    ? draft?.monitorId === m.id
      ? {
          ...m,
          url: draft.url,
          selector: draft.selector,
          ignoreSelectors: draft.ignoreSelectors,
        }
      : m
    : undefined) || {
    name: "新監控",
    url: draft?.url || "",
    selector: draft?.selector || "",
    ignoreSelectors: draft?.ignoreSelectors || [],
    captureOptions: { text: true, links: true, images: true },
    intervalMinutes: 5,
    settleDelayMs: 2000,
    allowEmpty: false,
    notifications: true,
  };
  const fields: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};
  const field = (key: string, label: string, value: string, type = "text") => {
    const l = el("label", label),
      i = el("input");
    i.type = type;
    i.value = value;
    i.name = key;
    fields[key] = i;
    l.append(i);
    f.append(l);
    return i;
  };
  field("name", "名稱", source.name).required = true;
  field("url", "HTTP(S) 網址", source.url, "url").required = true;
  field("selector", "根 CSS selector", source.selector).required = true;
  const ignoreLabel = el("label", "忽略 selector（相對根元素，每行一個）"),
    ignore = el("textarea");
  ignore.value = source.ignoreSelectors.join("\n");
  ignoreLabel.append(ignore);
  f.append(ignoreLabel);
  fields.ignoreSelectors = ignore;
  const interval = field(
    "intervalMinutes",
    "間隔分鐘（1–1440；預設 5）",
    String(source.intervalMinutes),
    "number",
  );
  interval.min = "1";
  interval.max = "1440";
  interval.step = "1";
  const intervals = el("datalist");
  intervals.id = "intervals";
  for (const v of [1, 5, 10, 30, 60]) {
    const option = el("option");
    option.value = String(v);
    intervals.append(option);
  }
  interval.setAttribute("list", "intervals");
  f.append(intervals);
  const delay = field(
    "settleDelayMs",
    "載入後延遲秒數（0–30）",
    String(source.settleDelayMs / 1000),
    "number",
  );
  delay.min = "0";
  delay.max = "30";
  delay.step = "0.001";
  field(
    "readinessSelector",
    "就緒 selector（選填）",
    source.readinessSelector || "",
  );
  field(
    "failureSelector",
    "錯誤／登入 selector（選填）",
    source.failureSelector || "",
  );
  const checks: Record<string, HTMLInputElement> = {};
  for (const [key, label, value] of [
    ["text", "文字", source.captureOptions.text],
    ["links", "連結", source.captureOptions.links],
    ["images", "圖片網址", source.captureOptions.images],
    ["allowEmpty", "允許空內容", source.allowEmpty],
    ["notifications", "桌面變更通知", source.notifications],
  ] as const) {
    const l = el("label"),
      i = el("input");
    i.type = "checkbox";
    i.checked = value;
    checks[key] = i;
    l.append(i, document.createTextNode(label));
    f.append(l);
  }
  f.append(
    el(
      "p",
      "本機資料未加密，可能含私人內容或 URL 參數。來源授權涵蓋該來源所有路徑。自動排除隱藏子樹、輸入值、script/style 與選區工具；不因區域在畫面外排除。",
    ),
  );
  let tabId: number | undefined =
    draft?.url === source.url ? draft.tabId : undefined;
  let previewKey = "";
  const preview = el("pre");
  const read = (): Config =>
    config({
      name: fields.name.value,
      url: fields.url.value,
      selector: fields.selector.value,
      ignoreSelectors: ignore.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      captureOptions: {
        text: checks.text.checked,
        links: checks.links.checked,
        images: checks.images.checked,
      },
      intervalMinutes: Number(interval.value),
      settleDelayMs: Math.round(Number(delay.value) * 1000),
      readinessSelector: fields.readinessSelector.value,
      failureSelector: fields.failureSelector.value,
      allowEmpty: checks.allowEmpty.checked,
      notifications: checks.notifications.checked,
    });
  const requiresBaseline = (c: Config) =>
    !m ||
    [
      "url",
      "selector",
      "ignoreSelectors",
      "captureOptions",
      "readinessSelector",
      "failureSelector",
      "allowEmpty",
    ].some(
      (k) => JSON.stringify((c as any)[k]) !== JSON.stringify((m as any)[k]),
    );
  const open = button("開啟設定網頁", async () => {
    const u = new URL(fields.url.value);
    if (!["http:", "https:"].includes(u.protocol))
      throw Error("UNSUPPORTED_URL");
    tabId = (await chrome.tabs.create({ url: u.href })).id;
    preview.textContent =
      "已開啟設定分頁。請在該頁點擊擴充功能來視覺化選區，或回此頁進階編輯 selector。";
  });
  open.type = "button";
  f.append(open);
  const select = button("在設定分頁重新選區", async () => {
    if (!tabId) throw Error("請先開啟設定網頁");
    await chrome.tabs.update(tabId, { active: true });
    await send({ type: "START_PICKER", tabId, monitorId: m?.id });
  });
  select.type = "button";
  f.append(select);
  const pre = button("授權並驗證預覽", async () => {
    const c = read();
    if (!(await chrome.permissions.request({ origins: [c.origin + "/*"] })))
      throw Error("PERMISSION_REQUIRED");
    if (!tabId) throw Error("請先開啟設定網頁");
    const r = await send({ type: "PREVIEW_SELECTION", tabId, config: c });
    if (!r.ok) throw Error(r.error);
    preview.textContent = JSON.stringify(r.content, null, 2);
    previewKey = JSON.stringify(c);
  });
  pre.type = "button";
  f.append(pre, preview);
  const save = el("button", "授權並儲存");
  save.type = "submit";
  f.append(save);
  f.onsubmit = (e) => {
    e.preventDefault();
    let c: Config;
    try {
      c = read();
    } catch (err) {
      error(err);
      return;
    } // request must start directly in this user gesture.
    const granted = chrome.permissions.request({ origins: [c.origin + "/*"] });
    void granted
      .then(async (ok) => {
        if (!ok) throw Error("PERMISSION_REQUIRED");
        if (requiresBaseline(c)) {
          if (previewKey !== JSON.stringify(c))
            throw Error("請先驗證目前設定的預覽");
          if (
            !confirm(
              "將以專用背景分頁建立新基準，不將規則差異當成網站變更。繼續？",
            )
          )
            return;
        }
        await send(
          m
            ? { type: "UPDATE_MONITOR", id: m.id, config: c }
            : { type: "CREATE_MONITOR", config: c },
        );
        editing = false;
        await refresh();
      })
      .catch(error);
  };
  const cancel = button("返回", () => {
    editing = false;
    dashboard();
  });
  cancel.type = "button";
  f.append(cancel);
  app.append(f);
}
function history(id: string, eventId?: string) {
  editing = true;
  app.replaceChildren(
    el("h1", "變更歷史"),
    message,
    button("返回", () => {
      editing = false;
      void refresh();
    }),
  );
  const m = state.monitors.find((m: Monitor) => m.id === id);
  app.append(el("p", m?.name || id));
  const events = (state.events as ChangeEvent[])
    .filter((e) => e.monitorId === id && (!eventId || e.id === eventId))
    .sort((a, b) => b.detectedAt - a.detectedAt);
  if (!events.length) app.append(el("p", "尚無變更事件。建立基準不算變更。"));
  for (const e of events) {
    const card = el("article");
    card.append(
      el(
        "h2",
        `${time(e.detectedAt)} · 規則 v${e.configVersion}${e.readAt ? "" : " · 未讀"}`,
      ),
      button("標記已讀", async () => {
        await send({ type: "MARK_EVENT_READ", id: e.id });
        e.readAt = Date.now();
        history(id, eventId);
      }),
    );
    const before = state.snapshots.find(
        (s: Snapshot) => s.id === e.beforeSnapshotId,
      ),
      after = state.snapshots.find((s: Snapshot) => s.id === e.afterSnapshotId);
    if (!before || !after) {
      card.append(el("p", "快照不存在"));
      app.append(card);
      continue;
    }
    card.append(
      el("p", `網站 ${after.finalUrl} · 擷取 ${time(after.capturedAt)}`),
    );
    const columns = el("div");
    columns.className = "columns";
    const left = el("section"),
      right = el("section");
    left.append(el("h3", "舊內容"));
    right.append(el("h3", "新內容"));
    for (const [key, title] of [
      ["textBlocks", "文字"],
      ["links", "連結（依序）"],
      ["images", "圖片 URL／alt（依序，不載入歷史圖片）"],
    ] as const) {
      left.append(el("h4", title));
      right.append(el("h4", title));
      for (const row of diff<any>(before[key], after[key])) {
        const text =
          typeof row.value === "string" ? row.value : JSON.stringify(row.value);
        if (row.kind !== "added") {
          const p = el("pre", (row.kind === "removed" ? "− " : "  ") + text);
          p.className = row.kind;
          left.append(p);
        }
        if (row.kind !== "removed") {
          const p = el("pre", (row.kind === "added" ? "+ " : "  ") + text);
          p.className = row.kind;
          right.append(p);
        }
      }
    }
    columns.append(left, right);
    card.append(columns);
    app.append(card);
  }
}
function dataPage() {
  editing = true;
  app.replaceChildren(
    el("h1", "本機資料管理"),
    message,
    el(
      "p",
      "資料未加密且只存本機。匯出僅含設定，不含歷史、登入或授權。預設保留最近 30 天／每任務 50 事件；軟上限 50 MiB。",
    ),
    button("返回", () => {
      editing = false;
      void refresh();
    }),
  );
  const notifications = el("input");
  notifications.type = "checkbox";
  notifications.checked = state.settings.notificationsEnabled;
  const label = el("label", "啟用桌面變更通知");
  label.append(notifications);
  notifications.onchange = () => {
    void send({
      type: "SETTINGS",
      notificationsEnabled: notifications.checked,
    }).catch(error);
  };
  app.append(
    label,
    button("匯出設定 JSON", () => {
      const monitors = (state.monitors as Monitor[]).map((m) => config(m));
      const blob = new Blob(
        [JSON.stringify({ schemaVersion: 1, monitors }, null, 2)],
        { type: "application/json" },
      );
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = "dom-watch-settings.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }),
  );
  const input = el("input");
  input.type = "file";
  input.accept = ".json,application/json";
  const preview = el("pre");
  let imports: Config[] = [];
  input.onchange = () => {
    void (async () => {
      imports = [];
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 1024 * 1024) throw Error("匯入檔超過 1 MiB");
      const raw = JSON.parse(await file.text());
      if (
        raw.schemaVersion !== 1 ||
        !Array.isArray(raw.monitors) ||
        raw.monitors.length + state.monitors.length > 20
      )
        throw Error("匯入格式或任務上限錯誤");
      imports = raw.monitors.map(config);
      preview.textContent = imports
        .map((c) => `${c.name} · ${c.origin} · ${c.selector}`)
        .join("\n");
    })().catch(error);
  };
  app.append(
    el("label", "選擇設定檔"),
    input,
    preview,
    button("授權並匯入預覽任務", async () => {
      if (!imports.length) throw Error("請先選擇有效設定檔");
      const origins = [...new Set(imports.map((c) => c.origin + "/*"))];
      if (!(await chrome.permissions.request({ origins })))
        throw Error("PERMISSION_REQUIRED");
      for (const c of imports)
        await send({ type: "CREATE_MONITOR", config: c });
      imports = [];
      editing = false;
      await refresh();
    }),
    button("清除所有本機資料", async () => {
      if (confirm("永久清除所有任務、歷史與偏好？")) {
        await send({ type: "CLEAR_ALL" });
        editing = false;
        await refresh();
      }
    }),
  );
}
void refresh().catch(error);
setInterval(() => {
  if (!editing) void refresh().catch(error);
}, 5000);
