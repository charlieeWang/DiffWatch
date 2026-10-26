import {
  config,
  urlOf,
  errorMessages,
  diff,
  type Config,
  type Monitor,
  type Snapshot,
  type ChangeEvent,
  type Job,
  type Content,
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
function waitForPickerPage(tabId: number, origin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (err?: Error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      err ? reject(err) : resolve();
    };
    const check = (tab: chrome.tabs.Tab) => {
      if (
        tab.url &&
        tab.url !== "about:blank" &&
        new URL(tab.url).origin !== origin
      ) {
        finish(Error("REDIRECTED_ORIGIN"));
      } else if (
        tab.status === "complete" &&
        tab.url &&
        new URL(tab.url).origin === origin
      )
        finish();
    };
    const updated = (
      id: number,
      _change: chrome.tabs.OnUpdatedInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (id === tabId) check(tab);
    };
    const removed = (id: number) => {
      if (id === tabId) finish(Error("設定分頁已關閉"));
    };
    const timeout = setTimeout(
      () => finish(Error("網頁載入逾時，請稍後重試。")),
      30000,
    );
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    void chrome.tabs
      .get(tabId)
      .then(check, () => finish(Error("設定分頁已關閉")));
  });
}
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
  app.replaceChildren(el("h1", "DiffWatch"), message);
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
  app.replaceChildren(el("h1", "DiffWatch"), message);
  const controls = el("nav");
  const reload = button("", refresh);
  reload.className = "refresh-icon";
  reload.title = "重新整理";
  reload.setAttribute("aria-label", "重新整理");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M20 7v5h-5 M20 12a8 8 0 1 0-2.34 5.66 M20 12l-2.34-5.66",
  );
  icon.append(path);
  reload.append(icon);
  controls.append(
    button("新增任務", () => form()),
    button("資料管理", dataPage),
    button("錯誤紀錄", async () => {
      state = await send({ type: "STATE" });
      diagnosticsPage();
    }),
    reload,
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
    card.className = "monitor-card";
    const heading = el("header");
    heading.className = "monitor-heading";
    const identity = el("div");
    identity.className = "monitor-identity";
    identity.append(el("h2", m.name));
    heading.append(
      identity,
      button("編輯", () => form(m)),
    );
    card.append(
      heading,
      el("p", m.origin),
      el(
        "p",
        `${!m.enabled ? "暫停" : j ? "檢查中 · " + j.phase : health[m.health] || m.health}${!j && m.enabled && m.nextDueAt <= Date.now() ? " · 佇列等待" : ""} · 連續錯誤 ${m.consecutiveFailures}`,
      ),
    );
    const timings = el("dl");
    timings.className = "monitor-timings";
    for (const [label, value] of [
      ["最近嘗試", m.lastAttemptAt],
      ["最近成功", m.lastSuccessAt],
      ["最近變更", m.lastChangeAt],
      ["預計下次檢查", m.nextDueAt],
    ] as const) {
      const item = el("div");
      item.append(
        el("dt", label),
        el(
          "dd",
          label === "預計下次檢查" && !m.enabled ? "已暫停" : time(value),
        ),
      );
      timings.append(item);
    }
    card.append(timings);
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
    const footer = el("footer");
    footer.className = "monitor-footer";
    const actions = el("div");
    actions.className = "monitor-actions";
    const toggle = button(m.enabled ? "已啟用" : "已暫停", async () => {
      toggle.disabled = true;
      try {
        await send({
          type: m.enabled ? "PAUSE_MONITOR" : "RESUME_MONITOR",
          id: m.id,
        });
        await refresh();
      } finally {
        toggle.disabled = false;
      }
    });
    toggle.className = "monitor-switch";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(m.enabled));
    toggle.setAttribute("aria-label", `${m.name}：啟用監控`);
    identity.append(toggle);
    actions.append(
      run,
      button("開啟網站", () => chrome.tabs.create({ url: m.url })),
      button("歷史", () => history(m.id)),
      button("重新設定基準", async () => {
        if (confirm("將以新快照建立基準，不產生變更事件。確定？")) {
          await send({ type: "RESET_BASELINE", id: m.id });
          await refresh();
        }
      }),
    );
    const remove = button("刪除任務", async () => {
      if (confirm("刪除此任務及所有歷史？")) {
        await send({ type: "DELETE_MONITOR", id: m.id });
        await refresh();
      }
    });
    remove.className = "delete-link";
    footer.append(actions, remove);
    card.append(footer);
    if (m.health === "needs_permission")
      card.insertBefore(
        button("重新授權", async () => {
          if (
            await chrome.permissions.request({ origins: [m.origin + "/*"] })
          ) {
            await send({ type: "RESUME_MONITOR", id: m.id });
            await refresh();
          }
        }),
        footer,
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
  const field = (
    key: string,
    label: string,
    value: string,
    type = "text",
    container: HTMLElement = f,
  ) => {
    const l = el("label", label),
      i = el("input");
    i.type = type;
    i.value = value;
    i.name = key;
    fields[key] = i;
    l.append(i);
    container.append(l);
    return i;
  };
  field("name", "名稱", source.name).required = true;
  field("url", "HTTP(S) 網址", source.url, "url").required = true;
  const regionSummary = el("p");
  regionSummary.className = "region-summary";
  regionSummary.setAttribute("role", "status");
  f.append(regionSummary);
  const advanced = el("details");
  advanced.className = "form-advanced";
  advanced.append(
    el("summary", "進階設定"),
    el("p", "以下規則會在選區時自動產生。若手動修改，需要重新驗證預覽。"),
  );
  const explain = (
    input: HTMLInputElement | HTMLTextAreaElement,
    text: string,
  ) => {
    const help = el("small", text);
    help.id = `help-${input.name}`;
    help.className = "field-help";
    input.setAttribute("aria-describedby", help.id);
    input.parentElement!.after(help);
  };
  const rootRule = field(
    "selector",
    "監控範圍",
    source.selector,
    "text",
    advanced,
  );
  explain(rootRule, "用來找到你選取的監控範圍。");
  const ignoreLabel = el("label", "不比較的區塊（CSS，每行一個）"),
    ignore = el("textarea");
  ignore.value = source.ignoreSelectors.join("\n");
  ignore.name = "ignoreSelectors";
  ignoreLabel.append(ignore);
  advanced.append(ignoreLabel);
  explain(ignore, "在監控範圍需要忽略的區塊；若為空則表示沒有需要排除的區域。");
  fields.ignoreSelectors = ignore;
  const interval = field(
    "intervalMinutes",
    "每次檢查間隔時間（1–1440；預設 5；單位為分鐘）",
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
    "網頁開啟後，延遲幾秒後再檢查（0–30）",
    String(source.settleDelayMs / 1000),
    "number",
  );
  delay.min = "0";
  delay.max = "30";
  delay.step = "0.001";
  const readyRule = field(
    "readinessSelector",
    "等待此區塊出現才檢查（CSS，選填）",
    source.readinessSelector || "",
    "text",
    advanced,
  );
  explain(
    readyRule,
    "適合內容較晚載入的網站：等指定區塊出現才開始比較。留空即可使用一般等待流程。",
  );
  const failureRule = field(
    "failureSelector",
    "看到這個區塊就停止本次檢查（CSS，選填）",
    source.failureSelector || "",
    "text",
    advanced,
  );
  explain(
    failureRule,
    "可指定登入提示或錯誤訊息的區塊，出現時保留原基準。這需要你自行設定，不會自動辨識所有登入或錯誤頁。",
  );
  f.append(advanced);
  const updateRegionSummary = () => {
    const ignored = ignore.value.split("\n").filter((s) => s.trim()).length;
    regionSummary.textContent = fields.selector.value.trim()
      ? `已設定監控範圍${ignored ? `，已忽略 ${ignored} 個區塊` : ""}。想調整範圍，請用下方按鈕直接在網頁點選。`
      : "尚未選取監控範圍。請用下方按鈕開啟網頁，再點選想追蹤的內容。";
  };
  updateRegionSummary();
  f.addEventListener("input", updateRegionSummary);
  const checks: Record<string, HTMLInputElement> = {};
  const capturePanel = el("section");
  capturePanel.className = "capture-preview";
  capturePanel.append(el("h2", "調整監控內容"));
  const captureChoices = el("div");
  captureChoices.className = "capture-choices";
  capturePanel.append(captureChoices);
  for (const [key, label, value] of [
    ["text", "文字", source.captureOptions.text],
    ["links", "連結", source.captureOptions.links],
    ["images", "圖片網址", source.captureOptions.images],
    ["allowEmpty", "允許空內容", source.allowEmpty],
    ["notifications", "桌面通知", source.notifications],
  ] as const) {
    const l = el("label"),
      i = el("input");
    i.type = "checkbox";
    i.checked = value;
    i.name = key;
    checks[key] = i;
    l.append(i, document.createTextNode(label));
    if (["text", "links", "images"].includes(key)) captureChoices.append(l);
    else f.append(l);
    if (key === "allowEmpty")
      explain(
        i,
        "未勾選時，如果沒有抓到任何已勾選的內容，會視為檢查失敗並保留原基準，避免網頁還沒載好就誤報。勾選後，空白也會當成有效結果，可能記錄為內容已被清空。一般建議保持關閉。",
      );
  }
  let sample: Content | undefined = m
    ? state.snapshots.find((s: Snapshot) => s.id === m.baselineSnapshotId)
    : undefined;
  const storedSample = sample as Snapshot | undefined;
  let sampleConfig = JSON.stringify([
    m?.url ?? source.url,
    m?.selector ?? source.selector,
    m?.ignoreSelectors ?? source.ignoreSelectors,
  ]);
  let sampleLabel = storedSample
    ? `目前儲存的快照 · ${time(storedSample.capturedAt)}`
    : "尚無快照";
  const sampleMeta = el("p");
  const sampleBody = el("div");
  sampleMeta.setAttribute("role", "status");
  capturePanel.append(sampleMeta, sampleBody);
  function renderSample() {
    sampleBody.replaceChildren();
    const currentConfig = JSON.stringify([
      fields.url.value,
      fields.selector.value,
      ignore.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ]);
    sampleMeta.textContent =
      sampleLabel +
      (sample && currentConfig !== sampleConfig
        ? "。網址或選區已修改，以下仍是原範圍的內容，請重新驗證預覽。"
        : "。勾選可即時切換下方顯示的內容；不會重新擷取網頁或修改已儲存的快照。");
    if (!sample) {
      sampleBody.append(
        el("p", "選好區域後，按「授權並擷取快照」即可查看實際擷取的內容。"),
      );
      return;
    }
    for (const [key, title, values] of [
      ["text", "文字", sample.textBlocks],
      ["links", "連結", sample.links.map((v) => `${v.text}\n${v.href}`)],
      ["images", "圖片網址", sample.images.map((v) => `${v.alt}\n${v.src}`)],
    ] as const) {
      if (!checks[key].checked) continue;
      const block = el("section");
      block.dataset.capture = key;
      block.append(el("h3", `${title}（${values.length} 筆）`));
      if (!sample.captureOptions[key])
        block.append(el("p", "這份快照未擷取此類內容，請重新驗證預覽。"));
      else if (!values.length) block.append(el("p", "沒有擷取到此類內容。"));
      else block.append(el("pre", values.join("\n\n")));
      sampleBody.append(block);
    }
    if (!["text", "links", "images"].some((key) => checks[key].checked))
      sampleBody.append(el("p", "請至少勾選一種要比較的內容。"));
  }
  renderSample();
  f.addEventListener("input", renderSample);
  f.append(
    el(
      "p",
      "本機資料未加密，可能含私人內容或 URL 參數。來源授權涵蓋該來源所有路徑。自動排除隱藏子樹、輸入值、script/style 與選區工具；不因區域在畫面外排除。",
    ),
  );
  let tabId: number | undefined =
    draft?.url === source.url ? draft.tabId : undefined;
  let previewKey = "";
  let previewBusy = false;
  let saving = false;
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
  const open = button("開啟網頁並選取區域", async () => {
    const u = urlOf(fields.url.value);
    // Start the optional permission request in this button's user gesture.
    const permission = chrome.permissions.request({
      origins: [u.origin + "/*"],
    });
    open.disabled = true;
    previewKey = "";
    updateSave();
    message.textContent = "";
    try {
      if (!(await permission)) throw Error("PERMISSION_REQUIRED");
      preview.textContent = "正在開啟網頁，載入完成後會自動顯示選區工具…";
      tabId = (await chrome.tabs.create({ url: u.href, active: true })).id;
      if (tabId === undefined) throw Error("無法開啟設定分頁");
      await waitForPickerPage(tabId, u.origin);
      await send({ type: "START_PICKER", tabId, monitorId: m?.id });
      preview.textContent = "選區工具已開啟，請直接在網頁選取監控範圍。";
    } finally {
      open.disabled = false;
    }
  });
  open.type = "button";
  const selectionTools = el("fieldset");
  selectionTools.className = "selection-tools";
  selectionTools.append(el("legend", "網頁與選區設定"), open);
  regionSummary.after(selectionTools);
  const pre = button("授權並擷取快照", async () => {
    const c = read();
    const requestedKey = JSON.stringify(c);
    previewKey = "";
    previewBusy = true;
    pre.disabled = true;
    message.textContent = "";
    updateSave();
    try {
      if (!(await chrome.permissions.request({ origins: [c.origin + "/*"] })))
        throw Error("PERMISSION_REQUIRED");
      if (!tabId) throw Error("請先開啟設定網頁");
      const r = await send({ type: "PREVIEW_SELECTION", tabId, config: c });
      if (!r.ok) throw Error(r.error);
      sample = r.content;
      sampleConfig = JSON.stringify([c.url, c.selector, c.ignoreSelectors]);
      sampleLabel = `本次驗證預覽 · ${time(Date.now())}（尚未儲存）`;
      renderSample();
      preview.textContent =
        "驗證成功，擷取內容已顯示在「調整監控內容」。儲存後會重新建立比對基準。";
      previewKey = requestedKey;
    } finally {
      previewBusy = false;
      pre.disabled = false;
      updateSave();
      void updateCaptureLabel();
    }
  });
  pre.type = "button";
  let permissionCheck = 0;
  async function updateCaptureLabel() {
    const check = ++permissionCheck;
    let granted = false;
    try {
      const origin = urlOf(fields.url.value).origin;
      granted = await chrome.permissions.contains({ origins: [origin + "/*"] });
    } catch {}
    if (check !== permissionCheck) return;
    pre.textContent = granted ? "重新擷取快照" : "授權並擷取快照";
    updateSave();
  }
  fields.url.addEventListener("input", () => void updateCaptureLabel());
  f.addEventListener("focusin", () => void updateCaptureLabel());
  f.append(pre, capturePanel, preview);
  const save = el("button", "授權並儲存");
  save.type = "submit";
  const saveHint = el("p");
  saveHint.className = "save-hint";
  saveHint.id = "save-hint";
  saveHint.setAttribute("role", "status");
  save.setAttribute("aria-describedby", saveHint.id);
  f.append(saveHint, save);
  function updateSave() {
    let needsPreview = true;
    let valid = false;
    try {
      const c = read();
      valid = true;
      needsPreview = requiresBaseline(c) && previewKey !== JSON.stringify(c);
    } catch {}
    save.disabled = !valid || needsPreview || previewBusy || saving;
    saveHint.textContent = previewBusy
      ? "正在驗證預覽…"
      : !valid
        ? "請完成有效的任務設定，再驗證預覽。"
        : needsPreview
          ? `請先按「${pre.textContent}」，成功後才能儲存。`
          : "設定已可儲存。";
  }
  f.addEventListener("input", updateSave);
  f.addEventListener("change", updateSave);
  updateSave();
  void updateCaptureLabel();
  f.onsubmit = (e) => {
    e.preventDefault();
    updateSave();
    if (save.disabled) return;
    message.textContent = "";
    let c: Config;
    try {
      c = read();
    } catch (err) {
      error(err);
      return;
    } // request must start directly in this user gesture.
    saving = true;
    updateSave();
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
      .catch(error)
      .finally(() => {
        saving = false;
        updateSave();
      });
  };
  const cancel = button("返回", () => {
    editing = false;
    dashboard();
  });
  cancel.type = "button";
  cancel.className = "back-icon";
  cancel.title = "返回任務列表";
  cancel.setAttribute("aria-label", "返回任務列表");
  cancel.textContent = "";
  const backSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  backSvg.setAttribute("viewBox", "0 0 24 24");
  backSvg.setAttribute("aria-hidden", "true");
  backSvg.setAttribute("fill", "none");
  backSvg.setAttribute("stroke", "currentColor");
  backSvg.setAttribute("stroke-width", "2");
  backSvg.setAttribute("stroke-linecap", "round");
  backSvg.setAttribute("stroke-linejoin", "round");
  const backPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  backPath.setAttribute("d", "M19 12H5 M12 5l-7 7 7 7");
  backSvg.append(backPath);
  cancel.append(backSvg);
  const formHeading = el("div");
  formHeading.className = "page-heading";
  const title = app.querySelector("h1")!;
  title.replaceWith(formHeading);
  formHeading.append(cancel, title);
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
  const markAll = button("全部標記已讀", async () => {
    markAll.disabled = true;
    try {
      await send({ type: "MARK_ALL_EVENTS_READ", monitorId: id });
      state = await send({ type: "STATE" });
      history(id, eventId);
    } finally {
      markAll.disabled = false;
    }
  });
  markAll.disabled = !(state.events as ChangeEvent[]).some(
    (e) => e.monitorId === id && !e.readAt,
  );
  markAll.title = "將此任務的所有歷史紀錄標記為已讀";
  app.append(markAll);
  const clearHistory = button("清除歷史紀錄", async () => {
    if (
      !confirm(
        "確定清除此任務的全部歷史紀錄？此操作無法復原，目前監控基準會保留。",
      )
    )
      return;
    clearHistory.disabled = true;
    try {
      await send({ type: "CLEAR_HISTORY", monitorId: id });
      state = await send({ type: "STATE" });
      history(id);
    } finally {
      clearHistory.disabled = false;
    }
  });
  clearHistory.disabled = !(state.events as ChangeEvent[]).some(
    (e) => e.monitorId === id,
  );
  app.append(clearHistory);
  const m = state.monitors.find((m: Monitor) => m.id === id);
  app.append(el("p", m?.name || id));
  const events = (state.events as ChangeEvent[])
    .filter((e) => e.monitorId === id && (!eventId || e.id === eventId))
    .sort((a, b) => b.detectedAt - a.detectedAt);
  if (!events.length) app.append(el("p", "尚無變更事件。建立基準不算變更。"));
  for (const e of events) {
    const card = el("article");
    const heading = el("header");
    heading.className = "history-heading";
    const readStatus = el("span", e.readAt ? "已讀" : "未讀");
    readStatus.className = e.readAt ? "history-read" : "history-unread";
    heading.append(
      el("h2", `${time(e.detectedAt)} · 規則 v${e.configVersion}`),
      readStatus,
    );
    card.append(heading);
    if (!e.readAt)
      card.append(
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
function diagnosticsPage() {
  editing = true;
  app.replaceChildren(el("h1", "錯誤紀錄"), message);
  app.append(
    el(
      "p",
      "保留最近 200 筆工作錯誤與取消紀錄，不含網頁正文、網址或登入資訊。舊版錯誤不會自動補回。",
    ),
    button("返回", () => {
      editing = false;
      void refresh();
    }),
    button("重新整理", async () => {
      state = await send({ type: "STATE" });
      diagnosticsPage();
    }),
    button("匯出紀錄", () => {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              app: "DiffWatch",
              version: chrome.runtime.getManifest().version,
              exportedAt: Date.now(),
              entries: state.diagnostics || [],
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const link = el("a");
      link.href = URL.createObjectURL(blob);
      link.download = "diffwatch-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }),
    button("清除紀錄", async () => {
      if (confirm("清除全部錯誤紀錄？任務與變更歷史會保留。")) {
        await send({ type: "CLEAR_DIAGNOSTICS" });
        state = await send({ type: "STATE" });
        diagnosticsPage();
      }
    }),
  );
  const entries = [...(state.diagnostics || [])].reverse();
  if (!entries.length) app.append(el("p", "目前沒有錯誤紀錄。"));
  for (const entry of entries) {
    const card = el("article");
    const monitor = state.monitors.find(
      (m: Monitor) => m.id === entry.monitorId,
    );
    card.append(
      el("h2", `${time(entry.occurredAt)} · ${entry.code}`),
      el("p", monitor?.name || entry.monitorId || "系統"),
      el(
        "p",
        errorMessages[entry.code] ||
          (
            {
              TAB_CLOSED: "使用者關閉工作分頁，當次檢查已取消。",
              TAB_TAKEN_OVER: "使用者接管或導覽分頁，當次檢查已取消。",
            } as Record<string, string>
          )[entry.code] ||
          "檢查失敗，請附上此紀錄回報。",
      ),
      el(
        "pre",
        `工作：${entry.runId || "—"}\n階段：${entry.phase || "—"}\n診斷：${entry.id}`,
      ),
    );
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
      a.download = "diffwatch-settings.json";
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
