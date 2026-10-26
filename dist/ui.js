// src/core.ts
var LIMIT = 256 * 1024;
function urlOf(raw) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.hostname === "chromewebstore.google.com" || u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore"))
    throw Error("UNSUPPORTED_URL");
  u.hash = "";
  return u;
}
function config(raw) {
  if (!raw || typeof raw !== "object") throw Error("INVALID_CONFIG");
  const v = raw;
  const str = (k, max = 2048) => {
    if (typeof v[k] !== "string" || v[k].length > max)
      throw Error("INVALID_" + k);
    return v[k].trim();
  };
  const u = urlOf(str("url"));
  const name = str("name", 120), selector = str("selector", 4096);
  if (!name || !selector || !Array.isArray(v.ignoreSelectors) || v.ignoreSelectors.length > 50 || !v.ignoreSelectors.every(
    (s) => typeof s === "string" && s.length > 0 && s.length < 4096
  ))
    throw Error("INVALID_CONFIG");
  const o = v.captureOptions;
  if (!o || !["text", "links", "images"].every((k) => typeof o[k] === "boolean") || !Object.values(o).some(Boolean))
    throw Error("INVALID_OPTIONS");
  if (!Number.isInteger(v.intervalMinutes) || v.intervalMinutes < 1 || v.intervalMinutes > 1440 || !Number.isInteger(v.settleDelayMs) || v.settleDelayMs < 0 || v.settleDelayMs > 3e4)
    throw Error("INVALID_INTERVAL");
  for (const k of ["readinessSelector", "failureSelector"])
    if (v[k] !== void 0 && (typeof v[k] !== "string" || v[k].length > 4096))
      throw Error("INVALID_SELECTOR");
  return {
    name,
    url: u.href,
    origin: u.origin,
    selector,
    ignoreSelectors: v.ignoreSelectors,
    captureOptions: { text: o.text, links: o.links, images: o.images },
    readinessSelector: v.readinessSelector || void 0,
    failureSelector: v.failureSelector || void 0,
    allowEmpty: v.allowEmpty === true,
    intervalMinutes: v.intervalMinutes,
    settleDelayMs: v.settleDelayMs,
    notifications: v.notifications !== false
  };
}
function diff(a, b) {
  const ak = a.map((x) => JSON.stringify(x)), bk = b.map((x) => JSON.stringify(x));
  let p = 0, s = 0;
  while (p < a.length && p < b.length && ak[p] === bk[p]) p++;
  while (s < a.length - p && s < b.length - p && ak[a.length - 1 - s] === bk[b.length - 1 - s])
    s++;
  const out = a.slice(0, p).map((value) => ({ kind: "same", value }));
  const n = a.length - p - s, m = b.length - p - s;
  if ((n + 1) * (m + 1) <= 1e6) {
    const rows = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i2 = n - 1; i2 >= 0; i2--)
      for (let j2 = m - 1; j2 >= 0; j2--)
        rows[i2][j2] = ak[p + i2] === bk[p + j2] ? rows[i2 + 1][j2 + 1] + 1 : Math.max(rows[i2 + 1][j2], rows[i2][j2 + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ak[p + i] === bk[p + j]) {
        out.push({ kind: "same", value: a[p + i++] });
        j++;
      } else if (i < n && (j === m || rows[i + 1][j] >= rows[i][j + 1]))
        out.push({ kind: "removed", value: a[p + i++] });
      else out.push({ kind: "added", value: b[p + j++] });
    }
  } else {
    out.push(
      ...a.slice(p, a.length - s).map((value) => ({ kind: "removed", value })),
      ...b.slice(p, b.length - s).map((value) => ({ kind: "added", value }))
    );
  }
  out.push(...a.slice(a.length - s).map((value) => ({ kind: "same", value })));
  return out;
}
var errorMessages = {
  OFFLINE: "\u76EE\u524D\u7DB2\u8DEF\u4E2D\u65B7\uFF0C\u5DF2\u4FDD\u7559\u57FA\u6E96\u4E26\u5B89\u6392\u9000\u907F\u91CD\u8A66\u3002",
  TAB_CLEANUP_FAILED: "\u80CC\u666F\u5206\u9801\u672A\u80FD\u95DC\u9589\uFF1B\u56DE\u6536\u5B8C\u6210\u524D\u4E0D\u6703\u70BA\u6B64\u4EFB\u52D9\u518D\u958B\u5206\u9801\u3002",
  PERMISSION_REQUIRED: "\u4F86\u6E90\u6388\u6B0A\u5DF2\u64A4\u92B7\uFF0C\u8ACB\u91CD\u65B0\u6388\u6B0A\u3002",
  SELECTOR_MISSING: "\u627E\u4E0D\u5230\u9078\u53D6\u5340\u57DF\uFF0C\u8ACB\u91CD\u65B0\u9078\u5340\u3002",
  SELECTOR_AMBIGUOUS: "\u9078\u53D6\u5668\u7B26\u5408\u591A\u500B\u5340\u57DF\uFF0C\u8ACB\u7E2E\u5C0F\u9078\u53D6\u7BC4\u570D\u3002",
  EMPTY_CONTENT: "\u5167\u5BB9\u70BA\u7A7A\uFF1B\u8ACB\u8ABF\u6574\u5EF6\u9072\u3001\u5340\u57DF\u6216\u660E\u78BA\u5141\u8A31\u7A7A\u5167\u5BB9\u3002",
  UNSTABLE_CONTENT: "\u5167\u5BB9\u6301\u7E8C\u8B8A\u52D5\uFF1B\u8ACB\u5FFD\u7565\u5012\u6578\u7B49\u5340\u57DF\u6216\u8ABF\u6574\u5EF6\u9072\u3002",
  LOGIN_OR_ERROR_DETECTED: "\u547D\u4E2D\u60A8\u8A2D\u5B9A\u7684\u932F\u8AA4\uFF0F\u767B\u5165 selector\uFF0C\u8ACB\u624B\u52D5\u8655\u7406\u3002",
  REDIRECTED_ORIGIN: "\u7DB2\u7AD9\u5C0E\u5411\u5176\u4ED6\u4F86\u6E90\uFF0C\u5DF2\u505C\u6B62\uFF1B\u8ACB\u7DE8\u8F2F\u4EFB\u52D9\u7DB2\u5740\u3002",
  SNAPSHOT_TOO_LARGE: "\u5340\u57DF\u8D85\u904E 20,000 \u7BC0\u9EDE\u6216 256 KiB\uFF0C\u8ACB\u7E2E\u5C0F\u7BC4\u570D\u3002",
  STORAGE_FULL: "\u5132\u5B58\u7A7A\u9593\u4E0D\u8DB3\uFF0C\u57FA\u6E96\u672A\u66F4\u65B0\uFF1B\u8ACB\u5148\u6E05\u7406\u8CC7\u6599\u3002",
  LOAD_TIMEOUT: "\u8F09\u5165\u6216\u53D6\u6A23\u903E\u6642\uFF0C\u5C07\u4F9D\u9000\u907F\u6642\u9593\u91CD\u8A66\u3002",
  WORKER_INTERRUPTED: "\u5DE5\u4F5C\u88AB\u4E2D\u65B7\uFF0C\u5DF2\u4FDD\u7559\u57FA\u6E96\u4E26\u5B89\u6392\u91CD\u8A66\u3002",
  INVALID_SELECTOR: "CSS selector \u8A9E\u6CD5\u7121\u6548\uFF0C\u8ACB\u7DE8\u8F2F\u8A2D\u5B9A\u3002"
};

// src/messages.ts
var send = async (message2) => {
  const r = await chrome.runtime.sendMessage(message2);
  if (!r?.ok) throw Error(r?.error || "\u80CC\u666F\u672A\u56DE\u61C9");
  return r.value;
};

// src/ui.ts
var app = document.querySelector("#app");
var el = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== void 0) n.textContent = text;
  return n;
};
var button = (label, fn) => {
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
var message = el("p");
message.setAttribute("role", "status");
function error(e) {
  message.textContent = "\u932F\u8AA4\uFF1A" + (e instanceof Error ? e.message : String(e));
  message.className = "error";
}
var time = (v) => v ? new Date(v).toLocaleString() : "\u2014";
function waitForPickerPage(tabId, origin) {
  return new Promise((resolve, reject) => {
    const finish = (err) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      err ? reject(err) : resolve();
    };
    const check = (tab) => {
      if (tab.url && tab.url !== "about:blank" && new URL(tab.url).origin !== origin) {
        finish(Error("REDIRECTED_ORIGIN"));
      } else if (tab.status === "complete" && tab.url && new URL(tab.url).origin === origin)
        finish();
    };
    const updated = (id, _change, tab) => {
      if (id === tabId) check(tab);
    };
    const removed = (id) => {
      if (id === tabId) finish(Error("\u8A2D\u5B9A\u5206\u9801\u5DF2\u95DC\u9589"));
    };
    const timeout = setTimeout(
      () => finish(Error("\u7DB2\u9801\u8F09\u5165\u903E\u6642\uFF0C\u8ACB\u7A0D\u5F8C\u91CD\u8A66\u3002")),
      3e4
    );
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    void chrome.tabs.get(tabId).then(check, () => finish(Error("\u8A2D\u5B9A\u5206\u9801\u5DF2\u95DC\u9589")));
  });
}
var state;
var editing = false;
var health = {
  initializing: "\u5EFA\u7ACB\u57FA\u6E96\u4E2D",
  healthy: "\u76E3\u63A7\u4E2D",
  retrying: "\u91CD\u8A66\u4E2D",
  needs_permission: "\u9700\u8981\u91CD\u65B0\u6388\u6B0A",
  needs_attention: "\u9700\u8981\u8655\u7406"
};
async function refresh() {
  state = await send({ type: "STATE" });
  if (document.body.dataset.page === "popup") return popup();
  if (!editing) dashboard();
}
function popup() {
  app.replaceChildren(el("h1", "DiffWatch"), message);
  const ms = state.monitors, es = state.events;
  app.append(
    el(
      "p",
      `\u76E3\u63A7\u4E2D ${ms.filter((m) => m.enabled && m.health === "healthy").length} \xB7 \u932F\u8AA4 ${ms.filter((m) => m.lastError || m.health === "needs_permission").length} \xB7 \u672A\u8B80 ${es.filter((e) => !e.readAt).length}`
    ),
    button("\u76E3\u63A7\u76EE\u524D\u9801\u9762", async () => {
      await send({ type: "START_PICKER" });
      window.close();
    }),
    button(
      "\u958B\u555F\u7BA1\u7406\u9801",
      () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") })
    )
  );
}
function dashboard() {
  app.replaceChildren(el("h1", "DiffWatch"), message);
  const controls = el("nav");
  const reload = button("", refresh);
  reload.className = "refresh-icon";
  reload.title = "\u91CD\u65B0\u6574\u7406";
  reload.setAttribute("aria-label", "\u91CD\u65B0\u6574\u7406");
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
    "M20 7v5h-5 M20 12a8 8 0 1 0-2.34 5.66 M20 12l-2.34-5.66"
  );
  icon.append(path);
  reload.append(icon);
  controls.append(
    button("\u65B0\u589E\u4EFB\u52D9", () => form()),
    button("\u8CC7\u6599\u7BA1\u7406", dataPage),
    button("\u932F\u8AA4\u7D00\u9304", async () => {
      state = await send({ type: "STATE" });
      diagnosticsPage();
    }),
    reload
  );
  app.append(
    controls,
    el(
      "p",
      "\u6BD4\u8F03\u6587\u5B57\u3001\u9023\u7D50\u53CA\u5716\u7247\u7DB2\u5740\uFF0C\u4E0D\u6BD4\u5C0D\u622A\u5716\u3002\u80CC\u666F\u5206\u9801\u53EF\u898B\u65BC\u5206\u9801\u5217\uFF1B\u6AA2\u67E5\u6642\u9593\u53EF\u80FD\u5EF6\u5F8C\u3002"
    )
  );
  for (const m of state.monitors) {
    const card = el("article");
    const j = state.jobs.find(
      (j2) => j2.monitorId === m.id && !["finished", "cancelled", "failed"].includes(j2.phase)
    );
    card.className = "monitor-card";
    const heading = el("header");
    heading.className = "monitor-heading";
    const identity = el("div");
    identity.className = "monitor-identity";
    identity.append(el("h2", m.name));
    heading.append(
      identity,
      button("\u7DE8\u8F2F", () => form(m))
    );
    card.append(
      heading,
      el("p", m.origin),
      el(
        "p",
        `${!m.enabled ? "\u66AB\u505C" : j ? "\u6AA2\u67E5\u4E2D \xB7 " + j.phase : health[m.health] || m.health}${!j && m.enabled && m.nextDueAt <= Date.now() ? " \xB7 \u4F47\u5217\u7B49\u5F85" : ""} \xB7 \u9023\u7E8C\u932F\u8AA4 ${m.consecutiveFailures}`
      )
    );
    const timings = el("dl");
    timings.className = "monitor-timings";
    for (const [label, value] of [
      ["\u6700\u8FD1\u5617\u8A66", m.lastAttemptAt],
      ["\u6700\u8FD1\u6210\u529F", m.lastSuccessAt],
      ["\u6700\u8FD1\u8B8A\u66F4", m.lastChangeAt],
      ["\u9810\u8A08\u4E0B\u6B21\u6AA2\u67E5", m.nextDueAt]
    ]) {
      const item = el("div");
      item.append(
        el("dt", label),
        el(
          "dd",
          label === "\u9810\u8A08\u4E0B\u6B21\u6AA2\u67E5" && !m.enabled ? "\u5DF2\u66AB\u505C" : time(value)
        )
      );
      timings.append(item);
    }
    card.append(timings);
    if (j && Date.now() > j.deadlineAt)
      card.append(el("p", "\u5DE5\u4F5C\u5DF2\u903E\u6642\uFF0C\u7B49\u5F85 dispatcher \u6E05\u7406\u3002"));
    if (m.lastError)
      card.append(
        el(
          "p",
          `${m.lastError.code}\uFF1A${m.lastError.userMessage} \xB7 \u8A3A\u65B7 ${m.lastError.diagnosticId}`
        )
      );
    const run = button("\u7ACB\u5373\u6AA2\u67E5", async () => {
      await send({ type: "RUN_NOW", id: m.id });
      await refresh();
    });
    run.disabled = !!j;
    const footer = el("footer");
    footer.className = "monitor-footer";
    const actions = el("div");
    actions.className = "monitor-actions";
    const toggle = button(m.enabled ? "\u5DF2\u555F\u7528" : "\u5DF2\u66AB\u505C", async () => {
      toggle.disabled = true;
      try {
        await send({
          type: m.enabled ? "PAUSE_MONITOR" : "RESUME_MONITOR",
          id: m.id
        });
        await refresh();
      } finally {
        toggle.disabled = false;
      }
    });
    toggle.className = "monitor-switch";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(m.enabled));
    toggle.setAttribute("aria-label", `${m.name}\uFF1A\u555F\u7528\u76E3\u63A7`);
    identity.append(toggle);
    actions.append(
      run,
      button("\u958B\u555F\u7DB2\u7AD9", () => chrome.tabs.create({ url: m.url })),
      button("\u6B77\u53F2", () => history(m.id)),
      button("\u91CD\u65B0\u8A2D\u5B9A\u57FA\u6E96", async () => {
        if (confirm("\u5C07\u4EE5\u65B0\u5FEB\u7167\u5EFA\u7ACB\u57FA\u6E96\uFF0C\u4E0D\u7522\u751F\u8B8A\u66F4\u4E8B\u4EF6\u3002\u78BA\u5B9A\uFF1F")) {
          await send({ type: "RESET_BASELINE", id: m.id });
          await refresh();
        }
      })
    );
    const remove = button("\u522A\u9664\u4EFB\u52D9", async () => {
      if (confirm("\u522A\u9664\u6B64\u4EFB\u52D9\u53CA\u6240\u6709\u6B77\u53F2\uFF1F")) {
        await send({ type: "DELETE_MONITOR", id: m.id });
        await refresh();
      }
    });
    remove.className = "delete-link";
    footer.append(actions, remove);
    card.append(footer);
    if (m.health === "needs_permission")
      card.insertBefore(
        button("\u91CD\u65B0\u6388\u6B0A", async () => {
          if (await chrome.permissions.request({ origins: [m.origin + "/*"] })) {
            await send({ type: "RESUME_MONITOR", id: m.id });
            await refresh();
          }
        }),
        footer
      );
    app.append(card);
  }
  if (!state.monitors.length)
    app.append(
      el("p", "\u5C1A\u7121\u4EFB\u52D9\u3002\u5148\u5728\u76EE\u6A19\u7DB2\u9801\u9EDE\u64CA\u64F4\u5145\u529F\u80FD\uFF0C\u9078\u64C7\u300C\u76E3\u63A7\u76EE\u524D\u9801\u9762\u300D\u3002")
    );
  const failed = state.outbox.filter((o) => o.state === "failed");
  if (failed.length)
    app.append(
      el(
        "p",
        `\u901A\u77E5\u6709 ${failed.length} \u7B46\u672A\u6210\u529F\u63D0\u4EA4\u6216\u5DF2\u505C\u7528\u3002\u4E8B\u4EF6\u4ECD\u4FDD\u7559\uFF1BAPI \u6210\u529F\u4E5F\u4E0D\u4EE3\u8868 OS \u5DF2\u986F\u793A\u3002`
      )
    );
  if (state.jobs.some(
    (j) => ["WORKER_INTERRUPTED", "LOAD_TIMEOUT", "REDIRECTED_ORIGIN"].includes(
      j.error || ""
    )
  ))
    app.append(
      el(
        "p",
        "\u66FE\u6709\u5DE5\u4F5C\u4E2D\u65B7\uFF1B\u7121\u6CD5\u8B49\u660E\u6240\u6709\u6B0A\u7684\u80CC\u666F\u5206\u9801\u6703\u4FDD\u7559\uFF0C\u53EF\u80FD\u9700\u8981\u624B\u52D5\u95DC\u9589\u3002"
      )
    );
  const hash = decodeURIComponent(location.hash);
  if (hash === "#new") {
    location.hash = "";
    form(state.monitors.find((m) => m.id === state.draft?.monitorId));
  } else if (hash.startsWith("#event=")) {
    location.hash = "";
    const e = state.events.find(
      (e2) => e2.id === new URLSearchParams(hash.slice(1)).get("event")
    );
    if (e) history(e.monitorId, e.id);
    else {
      const monitorId = new URLSearchParams(hash.slice(1)).get("monitor");
      if (monitorId && state.monitors.some((m) => m.id === monitorId))
        history(monitorId);
      message.textContent = "\u4E8B\u4EF6\u5DF2\u88AB\u6E05\u7406\uFF0C\u5DF2\u986F\u793A\u4ECD\u4FDD\u7559\u7684\u4EFB\u52D9\u7D00\u9304\u3002";
    }
  }
}
function form(m) {
  editing = true;
  app.replaceChildren(el("h1", m ? "\u7DE8\u8F2F\u4EFB\u52D9" : "\u65B0\u589E\u4EFB\u52D9"), message);
  const f = el("form");
  const draft = state.draft;
  const source = (m ? draft?.monitorId === m.id ? {
    ...m,
    url: draft.url,
    selector: draft.selector,
    ignoreSelectors: draft.ignoreSelectors
  } : m : void 0) || {
    name: "\u65B0\u76E3\u63A7",
    url: draft?.url || "",
    selector: draft?.selector || "",
    ignoreSelectors: draft?.ignoreSelectors || [],
    captureOptions: { text: true, links: true, images: true },
    intervalMinutes: 5,
    settleDelayMs: 2e3,
    allowEmpty: false,
    notifications: true
  };
  const fields = {};
  const field = (key, label, value, type = "text", container = f) => {
    const l = el("label", label), i = el("input");
    i.type = type;
    i.value = value;
    i.name = key;
    fields[key] = i;
    l.append(i);
    container.append(l);
    return i;
  };
  field("name", "\u540D\u7A31", source.name).required = true;
  field("url", "HTTP(S) \u7DB2\u5740", source.url, "url").required = true;
  const regionSummary = el("p");
  regionSummary.className = "region-summary";
  regionSummary.setAttribute("role", "status");
  f.append(regionSummary);
  const advanced = el("details");
  advanced.className = "form-advanced";
  advanced.append(
    el("summary", "\u9032\u968E\u8A2D\u5B9A"),
    el("p", "\u4EE5\u4E0B\u898F\u5247\u6703\u5728\u9078\u5340\u6642\u81EA\u52D5\u7522\u751F\u3002\u82E5\u624B\u52D5\u4FEE\u6539\uFF0C\u9700\u8981\u91CD\u65B0\u9A57\u8B49\u9810\u89BD\u3002")
  );
  const explain = (input, text) => {
    const help = el("small", text);
    help.id = `help-${input.name}`;
    help.className = "field-help";
    input.setAttribute("aria-describedby", help.id);
    input.parentElement.after(help);
  };
  const rootRule = field(
    "selector",
    "\u76E3\u63A7\u7BC4\u570D",
    source.selector,
    "text",
    advanced
  );
  explain(rootRule, "\u7528\u4F86\u627E\u5230\u4F60\u9078\u53D6\u7684\u76E3\u63A7\u7BC4\u570D\u3002");
  const ignoreLabel = el("label", "\u4E0D\u6BD4\u8F03\u7684\u5340\u584A\uFF08CSS\uFF0C\u6BCF\u884C\u4E00\u500B\uFF09"), ignore = el("textarea");
  ignore.value = source.ignoreSelectors.join("\n");
  ignore.name = "ignoreSelectors";
  ignoreLabel.append(ignore);
  advanced.append(ignoreLabel);
  explain(ignore, "\u5728\u76E3\u63A7\u7BC4\u570D\u9700\u8981\u5FFD\u7565\u7684\u5340\u584A\uFF1B\u82E5\u70BA\u7A7A\u5247\u8868\u793A\u6C92\u6709\u9700\u8981\u6392\u9664\u7684\u5340\u57DF\u3002");
  fields.ignoreSelectors = ignore;
  const interval = field(
    "intervalMinutes",
    "\u6BCF\u6B21\u6AA2\u67E5\u9593\u9694\u6642\u9593\uFF081\u20131440\uFF1B\u9810\u8A2D 5\uFF1B\u55AE\u4F4D\u70BA\u5206\u9418\uFF09",
    String(source.intervalMinutes),
    "number"
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
    "\u7DB2\u9801\u958B\u555F\u5F8C\uFF0C\u5EF6\u9072\u5E7E\u79D2\u5F8C\u518D\u6AA2\u67E5\uFF080\u201330\uFF09",
    String(source.settleDelayMs / 1e3),
    "number"
  );
  delay.min = "0";
  delay.max = "30";
  delay.step = "0.001";
  const readyRule = field(
    "readinessSelector",
    "\u7B49\u5F85\u6B64\u5340\u584A\u51FA\u73FE\u624D\u6AA2\u67E5\uFF08CSS\uFF0C\u9078\u586B\uFF09",
    source.readinessSelector || "",
    "text",
    advanced
  );
  explain(
    readyRule,
    "\u9069\u5408\u5167\u5BB9\u8F03\u665A\u8F09\u5165\u7684\u7DB2\u7AD9\uFF1A\u7B49\u6307\u5B9A\u5340\u584A\u51FA\u73FE\u624D\u958B\u59CB\u6BD4\u8F03\u3002\u7559\u7A7A\u5373\u53EF\u4F7F\u7528\u4E00\u822C\u7B49\u5F85\u6D41\u7A0B\u3002"
  );
  const failureRule = field(
    "failureSelector",
    "\u770B\u5230\u9019\u500B\u5340\u584A\u5C31\u505C\u6B62\u672C\u6B21\u6AA2\u67E5\uFF08CSS\uFF0C\u9078\u586B\uFF09",
    source.failureSelector || "",
    "text",
    advanced
  );
  explain(
    failureRule,
    "\u53EF\u6307\u5B9A\u767B\u5165\u63D0\u793A\u6216\u932F\u8AA4\u8A0A\u606F\u7684\u5340\u584A\uFF0C\u51FA\u73FE\u6642\u4FDD\u7559\u539F\u57FA\u6E96\u3002\u9019\u9700\u8981\u4F60\u81EA\u884C\u8A2D\u5B9A\uFF0C\u4E0D\u6703\u81EA\u52D5\u8FA8\u8B58\u6240\u6709\u767B\u5165\u6216\u932F\u8AA4\u9801\u3002"
  );
  f.append(advanced);
  const updateRegionSummary = () => {
    const ignored = ignore.value.split("\n").filter((s) => s.trim()).length;
    regionSummary.textContent = fields.selector.value.trim() ? `\u5DF2\u8A2D\u5B9A\u76E3\u63A7\u7BC4\u570D${ignored ? `\uFF0C\u5DF2\u5FFD\u7565 ${ignored} \u500B\u5340\u584A` : ""}\u3002\u60F3\u8ABF\u6574\u7BC4\u570D\uFF0C\u8ACB\u7528\u4E0B\u65B9\u6309\u9215\u76F4\u63A5\u5728\u7DB2\u9801\u9EDE\u9078\u3002` : "\u5C1A\u672A\u9078\u53D6\u76E3\u63A7\u7BC4\u570D\u3002\u8ACB\u7528\u4E0B\u65B9\u6309\u9215\u958B\u555F\u7DB2\u9801\uFF0C\u518D\u9EDE\u9078\u60F3\u8FFD\u8E64\u7684\u5167\u5BB9\u3002";
  };
  updateRegionSummary();
  f.addEventListener("input", updateRegionSummary);
  const checks = {};
  const capturePanel = el("section");
  capturePanel.className = "capture-preview";
  capturePanel.append(el("h2", "\u8ABF\u6574\u76E3\u63A7\u5167\u5BB9"));
  const captureChoices = el("div");
  captureChoices.className = "capture-choices";
  capturePanel.append(captureChoices);
  for (const [key, label, value] of [
    ["text", "\u6587\u5B57", source.captureOptions.text],
    ["links", "\u9023\u7D50", source.captureOptions.links],
    ["images", "\u5716\u7247\u7DB2\u5740", source.captureOptions.images],
    ["allowEmpty", "\u5141\u8A31\u7A7A\u5167\u5BB9", source.allowEmpty],
    ["notifications", "\u684C\u9762\u901A\u77E5", source.notifications]
  ]) {
    const l = el("label"), i = el("input");
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
        "\u672A\u52FE\u9078\u6642\uFF0C\u5982\u679C\u6C92\u6709\u6293\u5230\u4EFB\u4F55\u5DF2\u52FE\u9078\u7684\u5167\u5BB9\uFF0C\u6703\u8996\u70BA\u6AA2\u67E5\u5931\u6557\u4E26\u4FDD\u7559\u539F\u57FA\u6E96\uFF0C\u907F\u514D\u7DB2\u9801\u9084\u6C92\u8F09\u597D\u5C31\u8AA4\u5831\u3002\u52FE\u9078\u5F8C\uFF0C\u7A7A\u767D\u4E5F\u6703\u7576\u6210\u6709\u6548\u7D50\u679C\uFF0C\u53EF\u80FD\u8A18\u9304\u70BA\u5167\u5BB9\u5DF2\u88AB\u6E05\u7A7A\u3002\u4E00\u822C\u5EFA\u8B70\u4FDD\u6301\u95DC\u9589\u3002"
      );
  }
  let sample = m ? state.snapshots.find((s) => s.id === m.baselineSnapshotId) : void 0;
  const storedSample = sample;
  let sampleConfig = JSON.stringify([
    m?.url ?? source.url,
    m?.selector ?? source.selector,
    m?.ignoreSelectors ?? source.ignoreSelectors
  ]);
  let sampleLabel = storedSample ? `\u76EE\u524D\u5132\u5B58\u7684\u5FEB\u7167 \xB7 ${time(storedSample.capturedAt)}` : "\u5C1A\u7121\u5FEB\u7167";
  const sampleMeta = el("p");
  const sampleBody = el("div");
  sampleMeta.setAttribute("role", "status");
  capturePanel.append(sampleMeta, sampleBody);
  function renderSample() {
    sampleBody.replaceChildren();
    const currentConfig = JSON.stringify([
      fields.url.value,
      fields.selector.value,
      ignore.value.split("\n").map((s) => s.trim()).filter(Boolean)
    ]);
    sampleMeta.textContent = sampleLabel + (sample && currentConfig !== sampleConfig ? "\u3002\u7DB2\u5740\u6216\u9078\u5340\u5DF2\u4FEE\u6539\uFF0C\u4EE5\u4E0B\u4ECD\u662F\u539F\u7BC4\u570D\u7684\u5167\u5BB9\uFF0C\u8ACB\u91CD\u65B0\u9A57\u8B49\u9810\u89BD\u3002" : "\u3002\u52FE\u9078\u53EF\u5373\u6642\u5207\u63DB\u4E0B\u65B9\u986F\u793A\u7684\u5167\u5BB9\uFF1B\u4E0D\u6703\u91CD\u65B0\u64F7\u53D6\u7DB2\u9801\u6216\u4FEE\u6539\u5DF2\u5132\u5B58\u7684\u5FEB\u7167\u3002");
    if (!sample) {
      sampleBody.append(
        el("p", "\u9078\u597D\u5340\u57DF\u5F8C\uFF0C\u6309\u300C\u6388\u6B0A\u4E26\u64F7\u53D6\u5FEB\u7167\u300D\u5373\u53EF\u67E5\u770B\u5BE6\u969B\u64F7\u53D6\u7684\u5167\u5BB9\u3002")
      );
      return;
    }
    for (const [key, title2, values] of [
      ["text", "\u6587\u5B57", sample.textBlocks],
      ["links", "\u9023\u7D50", sample.links.map((v) => `${v.text}
${v.href}`)],
      ["images", "\u5716\u7247\u7DB2\u5740", sample.images.map((v) => `${v.alt}
${v.src}`)]
    ]) {
      if (!checks[key].checked) continue;
      const block = el("section");
      block.dataset.capture = key;
      block.append(el("h3", `${title2}\uFF08${values.length} \u7B46\uFF09`));
      if (!sample.captureOptions[key])
        block.append(el("p", "\u9019\u4EFD\u5FEB\u7167\u672A\u64F7\u53D6\u6B64\u985E\u5167\u5BB9\uFF0C\u8ACB\u91CD\u65B0\u9A57\u8B49\u9810\u89BD\u3002"));
      else if (!values.length) block.append(el("p", "\u6C92\u6709\u64F7\u53D6\u5230\u6B64\u985E\u5167\u5BB9\u3002"));
      else block.append(el("pre", values.join("\n\n")));
      sampleBody.append(block);
    }
    if (!["text", "links", "images"].some((key) => checks[key].checked))
      sampleBody.append(el("p", "\u8ACB\u81F3\u5C11\u52FE\u9078\u4E00\u7A2E\u8981\u6BD4\u8F03\u7684\u5167\u5BB9\u3002"));
  }
  renderSample();
  f.addEventListener("input", renderSample);
  f.append(
    el(
      "p",
      "\u672C\u6A5F\u8CC7\u6599\u672A\u52A0\u5BC6\uFF0C\u53EF\u80FD\u542B\u79C1\u4EBA\u5167\u5BB9\u6216 URL \u53C3\u6578\u3002\u4F86\u6E90\u6388\u6B0A\u6DB5\u84CB\u8A72\u4F86\u6E90\u6240\u6709\u8DEF\u5F91\u3002\u81EA\u52D5\u6392\u9664\u96B1\u85CF\u5B50\u6A39\u3001\u8F38\u5165\u503C\u3001script/style \u8207\u9078\u5340\u5DE5\u5177\uFF1B\u4E0D\u56E0\u5340\u57DF\u5728\u756B\u9762\u5916\u6392\u9664\u3002"
    )
  );
  let tabId = draft?.url === source.url ? draft.tabId : void 0;
  let previewKey = "";
  let previewBusy = false;
  let saving = false;
  const preview = el("pre");
  const read = () => config({
    name: fields.name.value,
    url: fields.url.value,
    selector: fields.selector.value,
    ignoreSelectors: ignore.value.split("\n").map((s) => s.trim()).filter(Boolean),
    captureOptions: {
      text: checks.text.checked,
      links: checks.links.checked,
      images: checks.images.checked
    },
    intervalMinutes: Number(interval.value),
    settleDelayMs: Math.round(Number(delay.value) * 1e3),
    readinessSelector: fields.readinessSelector.value,
    failureSelector: fields.failureSelector.value,
    allowEmpty: checks.allowEmpty.checked,
    notifications: checks.notifications.checked
  });
  const requiresBaseline = (c) => !m || [
    "url",
    "selector",
    "ignoreSelectors",
    "captureOptions",
    "readinessSelector",
    "failureSelector",
    "allowEmpty"
  ].some(
    (k) => JSON.stringify(c[k]) !== JSON.stringify(m[k])
  );
  const open = button("\u958B\u555F\u7DB2\u9801\u4E26\u9078\u53D6\u5340\u57DF", async () => {
    const u = urlOf(fields.url.value);
    const permission = chrome.permissions.request({
      origins: [u.origin + "/*"]
    });
    open.disabled = true;
    previewKey = "";
    updateSave();
    message.textContent = "";
    try {
      if (!await permission) throw Error("PERMISSION_REQUIRED");
      preview.textContent = "\u6B63\u5728\u958B\u555F\u7DB2\u9801\uFF0C\u8F09\u5165\u5B8C\u6210\u5F8C\u6703\u81EA\u52D5\u986F\u793A\u9078\u5340\u5DE5\u5177\u2026";
      tabId = (await chrome.tabs.create({ url: u.href, active: true })).id;
      if (tabId === void 0) throw Error("\u7121\u6CD5\u958B\u555F\u8A2D\u5B9A\u5206\u9801");
      await waitForPickerPage(tabId, u.origin);
      await send({ type: "START_PICKER", tabId, monitorId: m?.id });
      preview.textContent = "\u9078\u5340\u5DE5\u5177\u5DF2\u958B\u555F\uFF0C\u8ACB\u76F4\u63A5\u5728\u7DB2\u9801\u9078\u53D6\u76E3\u63A7\u7BC4\u570D\u3002";
    } finally {
      open.disabled = false;
    }
  });
  open.type = "button";
  const selectionTools = el("fieldset");
  selectionTools.className = "selection-tools";
  selectionTools.append(el("legend", "\u7DB2\u9801\u8207\u9078\u5340\u8A2D\u5B9A"), open);
  regionSummary.after(selectionTools);
  const pre = button("\u6388\u6B0A\u4E26\u64F7\u53D6\u5FEB\u7167", async () => {
    const c = read();
    const requestedKey = JSON.stringify(c);
    previewKey = "";
    previewBusy = true;
    pre.disabled = true;
    message.textContent = "";
    updateSave();
    try {
      if (!await chrome.permissions.request({ origins: [c.origin + "/*"] }))
        throw Error("PERMISSION_REQUIRED");
      if (!tabId) throw Error("\u8ACB\u5148\u958B\u555F\u8A2D\u5B9A\u7DB2\u9801");
      const r = await send({ type: "PREVIEW_SELECTION", tabId, config: c });
      if (!r.ok) throw Error(r.error);
      sample = r.content;
      sampleConfig = JSON.stringify([c.url, c.selector, c.ignoreSelectors]);
      sampleLabel = `\u672C\u6B21\u9A57\u8B49\u9810\u89BD \xB7 ${time(Date.now())}\uFF08\u5C1A\u672A\u5132\u5B58\uFF09`;
      renderSample();
      preview.textContent = "\u9A57\u8B49\u6210\u529F\uFF0C\u64F7\u53D6\u5167\u5BB9\u5DF2\u986F\u793A\u5728\u300C\u8ABF\u6574\u76E3\u63A7\u5167\u5BB9\u300D\u3002\u5132\u5B58\u5F8C\u6703\u91CD\u65B0\u5EFA\u7ACB\u6BD4\u5C0D\u57FA\u6E96\u3002";
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
    } catch {
    }
    if (check !== permissionCheck) return;
    pre.textContent = granted ? "\u91CD\u65B0\u64F7\u53D6\u5FEB\u7167" : "\u6388\u6B0A\u4E26\u64F7\u53D6\u5FEB\u7167";
    updateSave();
  }
  fields.url.addEventListener("input", () => void updateCaptureLabel());
  f.addEventListener("focusin", () => void updateCaptureLabel());
  f.append(pre, capturePanel, preview);
  const save = el("button", "\u6388\u6B0A\u4E26\u5132\u5B58");
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
    } catch {
    }
    save.disabled = !valid || needsPreview || previewBusy || saving;
    saveHint.textContent = previewBusy ? "\u6B63\u5728\u9A57\u8B49\u9810\u89BD\u2026" : !valid ? "\u8ACB\u5B8C\u6210\u6709\u6548\u7684\u4EFB\u52D9\u8A2D\u5B9A\uFF0C\u518D\u9A57\u8B49\u9810\u89BD\u3002" : needsPreview ? `\u8ACB\u5148\u6309\u300C${pre.textContent}\u300D\uFF0C\u6210\u529F\u5F8C\u624D\u80FD\u5132\u5B58\u3002` : "\u8A2D\u5B9A\u5DF2\u53EF\u5132\u5B58\u3002";
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
    let c;
    try {
      c = read();
    } catch (err) {
      error(err);
      return;
    }
    saving = true;
    updateSave();
    const granted = chrome.permissions.request({ origins: [c.origin + "/*"] });
    void granted.then(async (ok) => {
      if (!ok) throw Error("PERMISSION_REQUIRED");
      if (requiresBaseline(c)) {
        if (previewKey !== JSON.stringify(c))
          throw Error("\u8ACB\u5148\u9A57\u8B49\u76EE\u524D\u8A2D\u5B9A\u7684\u9810\u89BD");
        if (!confirm(
          "\u5C07\u4EE5\u5C08\u7528\u80CC\u666F\u5206\u9801\u5EFA\u7ACB\u65B0\u57FA\u6E96\uFF0C\u4E0D\u5C07\u898F\u5247\u5DEE\u7570\u7576\u6210\u7DB2\u7AD9\u8B8A\u66F4\u3002\u7E7C\u7E8C\uFF1F"
        ))
          return;
      }
      await send(
        m ? { type: "UPDATE_MONITOR", id: m.id, config: c } : { type: "CREATE_MONITOR", config: c }
      );
      editing = false;
      await refresh();
    }).catch(error).finally(() => {
      saving = false;
      updateSave();
    });
  };
  const cancel = button("\u8FD4\u56DE", () => {
    editing = false;
    dashboard();
  });
  cancel.type = "button";
  cancel.className = "back-icon";
  cancel.title = "\u8FD4\u56DE\u4EFB\u52D9\u5217\u8868";
  cancel.setAttribute("aria-label", "\u8FD4\u56DE\u4EFB\u52D9\u5217\u8868");
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
    "path"
  );
  backPath.setAttribute("d", "M19 12H5 M12 5l-7 7 7 7");
  backSvg.append(backPath);
  cancel.append(backSvg);
  const formHeading = el("div");
  formHeading.className = "page-heading";
  const title = app.querySelector("h1");
  title.replaceWith(formHeading);
  formHeading.append(cancel, title);
  app.append(f);
}
function history(id, eventId) {
  editing = true;
  app.replaceChildren(
    el("h1", "\u8B8A\u66F4\u6B77\u53F2"),
    message,
    button("\u8FD4\u56DE", () => {
      editing = false;
      void refresh();
    })
  );
  const markAll = button("\u5168\u90E8\u6A19\u8A18\u5DF2\u8B80", async () => {
    markAll.disabled = true;
    try {
      await send({ type: "MARK_ALL_EVENTS_READ", monitorId: id });
      state = await send({ type: "STATE" });
      history(id, eventId);
    } finally {
      markAll.disabled = false;
    }
  });
  markAll.disabled = !state.events.some(
    (e) => e.monitorId === id && !e.readAt
  );
  markAll.title = "\u5C07\u6B64\u4EFB\u52D9\u7684\u6240\u6709\u6B77\u53F2\u7D00\u9304\u6A19\u8A18\u70BA\u5DF2\u8B80";
  app.append(markAll);
  const clearHistory = button("\u6E05\u9664\u6B77\u53F2\u7D00\u9304", async () => {
    if (!confirm(
      "\u78BA\u5B9A\u6E05\u9664\u6B64\u4EFB\u52D9\u7684\u5168\u90E8\u6B77\u53F2\u7D00\u9304\uFF1F\u6B64\u64CD\u4F5C\u7121\u6CD5\u5FA9\u539F\uFF0C\u76EE\u524D\u76E3\u63A7\u57FA\u6E96\u6703\u4FDD\u7559\u3002"
    ))
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
  clearHistory.disabled = !state.events.some(
    (e) => e.monitorId === id
  );
  app.append(clearHistory);
  const m = state.monitors.find((m2) => m2.id === id);
  app.append(el("p", m?.name || id));
  const events = state.events.filter((e) => e.monitorId === id && (!eventId || e.id === eventId)).sort((a, b) => b.detectedAt - a.detectedAt);
  if (!events.length) app.append(el("p", "\u5C1A\u7121\u8B8A\u66F4\u4E8B\u4EF6\u3002\u5EFA\u7ACB\u57FA\u6E96\u4E0D\u7B97\u8B8A\u66F4\u3002"));
  for (const e of events) {
    const card = el("article");
    const heading = el("header");
    heading.className = "history-heading";
    const readStatus = el("span", e.readAt ? "\u5DF2\u8B80" : "\u672A\u8B80");
    readStatus.className = e.readAt ? "history-read" : "history-unread";
    heading.append(
      el("h2", `${time(e.detectedAt)} \xB7 \u898F\u5247 v${e.configVersion}`),
      readStatus
    );
    card.append(heading);
    if (!e.readAt)
      card.append(
        button("\u6A19\u8A18\u5DF2\u8B80", async () => {
          await send({ type: "MARK_EVENT_READ", id: e.id });
          e.readAt = Date.now();
          history(id, eventId);
        })
      );
    const before = state.snapshots.find(
      (s) => s.id === e.beforeSnapshotId
    ), after = state.snapshots.find((s) => s.id === e.afterSnapshotId);
    if (!before || !after) {
      card.append(el("p", "\u5FEB\u7167\u4E0D\u5B58\u5728"));
      app.append(card);
      continue;
    }
    card.append(
      el("p", `\u7DB2\u7AD9 ${after.finalUrl} \xB7 \u64F7\u53D6 ${time(after.capturedAt)}`)
    );
    const columns = el("div");
    columns.className = "columns";
    const left = el("section"), right = el("section");
    left.append(el("h3", "\u820A\u5167\u5BB9"));
    right.append(el("h3", "\u65B0\u5167\u5BB9"));
    for (const [key, title] of [
      ["textBlocks", "\u6587\u5B57"],
      ["links", "\u9023\u7D50\uFF08\u4F9D\u5E8F\uFF09"],
      ["images", "\u5716\u7247 URL\uFF0Falt\uFF08\u4F9D\u5E8F\uFF0C\u4E0D\u8F09\u5165\u6B77\u53F2\u5716\u7247\uFF09"]
    ]) {
      left.append(el("h4", title));
      right.append(el("h4", title));
      for (const row of diff(before[key], after[key])) {
        const text = typeof row.value === "string" ? row.value : JSON.stringify(row.value);
        if (row.kind !== "added") {
          const p = el("pre", (row.kind === "removed" ? "\u2212 " : "  ") + text);
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
  app.replaceChildren(el("h1", "\u932F\u8AA4\u7D00\u9304"), message);
  app.append(
    el(
      "p",
      "\u4FDD\u7559\u6700\u8FD1 200 \u7B46\u5DE5\u4F5C\u932F\u8AA4\u8207\u53D6\u6D88\u7D00\u9304\uFF0C\u4E0D\u542B\u7DB2\u9801\u6B63\u6587\u3001\u7DB2\u5740\u6216\u767B\u5165\u8CC7\u8A0A\u3002\u820A\u7248\u932F\u8AA4\u4E0D\u6703\u81EA\u52D5\u88DC\u56DE\u3002"
    ),
    button("\u8FD4\u56DE", () => {
      editing = false;
      void refresh();
    }),
    button("\u91CD\u65B0\u6574\u7406", async () => {
      state = await send({ type: "STATE" });
      diagnosticsPage();
    }),
    button("\u532F\u51FA\u7D00\u9304", () => {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              app: "DiffWatch",
              version: chrome.runtime.getManifest().version,
              exportedAt: Date.now(),
              entries: state.diagnostics || []
            },
            null,
            2
          )
        ],
        { type: "application/json" }
      );
      const link = el("a");
      link.href = URL.createObjectURL(blob);
      link.download = "diffwatch-diagnostics.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1e3);
    }),
    button("\u6E05\u9664\u7D00\u9304", async () => {
      if (confirm("\u6E05\u9664\u5168\u90E8\u932F\u8AA4\u7D00\u9304\uFF1F\u4EFB\u52D9\u8207\u8B8A\u66F4\u6B77\u53F2\u6703\u4FDD\u7559\u3002")) {
        await send({ type: "CLEAR_DIAGNOSTICS" });
        state = await send({ type: "STATE" });
        diagnosticsPage();
      }
    })
  );
  const entries = [...state.diagnostics || []].reverse();
  if (!entries.length) app.append(el("p", "\u76EE\u524D\u6C92\u6709\u932F\u8AA4\u7D00\u9304\u3002"));
  for (const entry of entries) {
    const card = el("article");
    const monitor = state.monitors.find(
      (m) => m.id === entry.monitorId
    );
    card.append(
      el("h2", `${time(entry.occurredAt)} \xB7 ${entry.code}`),
      el("p", monitor?.name || entry.monitorId || "\u7CFB\u7D71"),
      el(
        "p",
        errorMessages[entry.code] || {
          TAB_CLOSED: "\u4F7F\u7528\u8005\u95DC\u9589\u5DE5\u4F5C\u5206\u9801\uFF0C\u7576\u6B21\u6AA2\u67E5\u5DF2\u53D6\u6D88\u3002",
          TAB_TAKEN_OVER: "\u4F7F\u7528\u8005\u63A5\u7BA1\u6216\u5C0E\u89BD\u5206\u9801\uFF0C\u7576\u6B21\u6AA2\u67E5\u5DF2\u53D6\u6D88\u3002"
        }[entry.code] || "\u6AA2\u67E5\u5931\u6557\uFF0C\u8ACB\u9644\u4E0A\u6B64\u7D00\u9304\u56DE\u5831\u3002"
      ),
      el(
        "pre",
        `\u5DE5\u4F5C\uFF1A${entry.runId || "\u2014"}
\u968E\u6BB5\uFF1A${entry.phase || "\u2014"}
\u8A3A\u65B7\uFF1A${entry.id}`
      )
    );
    app.append(card);
  }
}
function dataPage() {
  editing = true;
  app.replaceChildren(
    el("h1", "\u672C\u6A5F\u8CC7\u6599\u7BA1\u7406"),
    message,
    el(
      "p",
      "\u8CC7\u6599\u672A\u52A0\u5BC6\u4E14\u53EA\u5B58\u672C\u6A5F\u3002\u532F\u51FA\u50C5\u542B\u8A2D\u5B9A\uFF0C\u4E0D\u542B\u6B77\u53F2\u3001\u767B\u5165\u6216\u6388\u6B0A\u3002\u9810\u8A2D\u4FDD\u7559\u6700\u8FD1 30 \u5929\uFF0F\u6BCF\u4EFB\u52D9 50 \u4E8B\u4EF6\uFF1B\u8EDF\u4E0A\u9650 50 MiB\u3002"
    ),
    button("\u8FD4\u56DE", () => {
      editing = false;
      void refresh();
    })
  );
  const notifications = el("input");
  notifications.type = "checkbox";
  notifications.checked = state.settings.notificationsEnabled;
  const label = el("label", "\u555F\u7528\u684C\u9762\u8B8A\u66F4\u901A\u77E5");
  label.append(notifications);
  notifications.onchange = () => {
    void send({
      type: "SETTINGS",
      notificationsEnabled: notifications.checked
    }).catch(error);
  };
  app.append(
    label,
    button("\u532F\u51FA\u8A2D\u5B9A JSON", () => {
      const monitors = state.monitors.map((m) => config(m));
      const blob = new Blob(
        [JSON.stringify({ schemaVersion: 1, monitors }, null, 2)],
        { type: "application/json" }
      );
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = "diffwatch-settings.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
    })
  );
  const input = el("input");
  input.type = "file";
  input.accept = ".json,application/json";
  const preview = el("pre");
  let imports = [];
  input.onchange = () => {
    void (async () => {
      imports = [];
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 1024 * 1024) throw Error("\u532F\u5165\u6A94\u8D85\u904E 1 MiB");
      const raw = JSON.parse(await file.text());
      if (raw.schemaVersion !== 1 || !Array.isArray(raw.monitors) || raw.monitors.length + state.monitors.length > 20)
        throw Error("\u532F\u5165\u683C\u5F0F\u6216\u4EFB\u52D9\u4E0A\u9650\u932F\u8AA4");
      imports = raw.monitors.map(config);
      preview.textContent = imports.map((c) => `${c.name} \xB7 ${c.origin} \xB7 ${c.selector}`).join("\n");
    })().catch(error);
  };
  app.append(
    el("label", "\u9078\u64C7\u8A2D\u5B9A\u6A94"),
    input,
    preview,
    button("\u6388\u6B0A\u4E26\u532F\u5165\u9810\u89BD\u4EFB\u52D9", async () => {
      if (!imports.length) throw Error("\u8ACB\u5148\u9078\u64C7\u6709\u6548\u8A2D\u5B9A\u6A94");
      const origins = [...new Set(imports.map((c) => c.origin + "/*"))];
      if (!await chrome.permissions.request({ origins }))
        throw Error("PERMISSION_REQUIRED");
      for (const c of imports)
        await send({ type: "CREATE_MONITOR", config: c });
      imports = [];
      editing = false;
      await refresh();
    }),
    button("\u6E05\u9664\u6240\u6709\u672C\u6A5F\u8CC7\u6599", async () => {
      if (confirm("\u6C38\u4E45\u6E05\u9664\u6240\u6709\u4EFB\u52D9\u3001\u6B77\u53F2\u8207\u504F\u597D\uFF1F")) {
        await send({ type: "CLEAR_ALL" });
        editing = false;
        await refresh();
      }
    })
  );
}
void refresh().catch(error);
setInterval(() => {
  if (!editing) void refresh().catch(error);
}, 5e3);
//# sourceMappingURL=ui.js.map
