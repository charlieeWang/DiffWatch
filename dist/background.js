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
function canonical(c) {
  return JSON.stringify({
    normalizationVersion: 1,
    captureOptions: c.captureOptions,
    textBlocks: c.captureOptions.text ? c.textBlocks : [],
    links: c.captureOptions.links ? c.links : [],
    images: c.captureOptions.images ? c.images : []
  });
}
async function digest(c) {
  const bytes = new TextEncoder().encode(canonical(c));
  if (bytes.length > LIMIT) throw Error("SNAPSHOT_TOO_LARGE");
  return {
    hash: Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
    ).map((b) => b.toString(16).padStart(2, "0")).join(""),
    byteLength: bytes.length
  };
}
var changed = (a, b) => canonical(a) !== canonical(b);
var backoff = (interval, failures) => Math.max(interval, Math.min(60, 2 ** Math.min(20, failures - 1))) * 6e4;
var errorMessages = {
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

// src/storage.ts
var stores = [
  "monitors",
  "snapshots",
  "changeEvents",
  "jobs",
  "notificationOutbox",
  "settings"
];
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("dom-watch", 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of stores) {
        const keyPath = name === "jobs" ? "runId" : name === "notificationOutbox" ? "eventId" : name === "settings" ? "key" : "id";
        const s = db.createObjectStore(name, { keyPath });
        if (name === "changeEvents")
          s.createIndex("runId", "runId", { unique: true });
      }
      r.transaction.objectStore("settings").put({
        key: "global",
        schemaVersion: 1,
        notificationsEnabled: true,
        retentionDays: 30,
        maxEventsPerMonitor: 50,
        uiPreferences: {}
      });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error("DATABASE_BLOCKED"));
  });
}
var request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function transaction(names, fn) {
  const db = await openDB();
  const tx = db.transaction(names, "readwrite");
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || Error("TRANSACTION_ABORTED"));
    tx.onerror = () => {
    };
  });
  try {
    const value = await fn(tx);
    await done;
    return value;
  } catch (e) {
    try {
      tx.abort();
    } catch {
    }
    await done.catch(() => {
    });
    throw e;
  } finally {
    db.close();
  }
}
async function all(name) {
  return transaction([name], (tx) => request(tx.objectStore(name).getAll()));
}
async function get(name, id) {
  return transaction([name], (tx) => request(tx.objectStore(name).get(id)));
}
var put = (name, value) => transaction([name], async (tx) => {
  await request(tx.objectStore(name).put(value));
});
async function save(raw, id) {
  const c = config(raw);
  return transaction(["monitors", "jobs"], async (tx) => {
    const ms = tx.objectStore("monitors"), js = tx.objectStore("jobs");
    const old = id ? await request(ms.get(id)) : void 0;
    if (id && !old) throw Error("MONITOR_DELETED");
    if (!old && await request(ms.count()) >= 20) throw Error("MAX_MONITORS");
    const now = Date.now();
    const reset = !old || [
      "url",
      "selector",
      "ignoreSelectors",
      "captureOptions",
      "readinessSelector",
      "failureSelector",
      "allowEmpty"
    ].some(
      (k) => JSON.stringify(old[k]) !== JSON.stringify(c[k])
    );
    const m = old ? {
      ...old,
      ...c,
      configVersion: old.configVersion + (reset ? 1 : 0),
      baselineSnapshotId: reset ? void 0 : old.baselineSnapshotId,
      health: reset ? "initializing" : old.health,
      nextDueAt: reset ? now : now + c.intervalMinutes * 6e4,
      updatedAt: now
    } : {
      ...c,
      id: crypto.randomUUID(),
      enabled: true,
      health: "initializing",
      configVersion: 1,
      nextDueAt: now,
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now
    };
    if (reset && old) {
      for (const j of await request(js.getAll()))
        if (j.monitorId === old.id) {
          j.phase = "cancelled";
          await request(js.put(j));
        }
    }
    await request(ms.put(m));
    return m;
  });
}
async function acquire(session2) {
  return transaction(["monitors", "jobs"], async (tx) => {
    const ms = tx.objectStore("monitors"), js = tx.objectStore("jobs");
    const monitors = await request(ms.getAll()), jobs = await request(js.getAll());
    const active = jobs.filter(
      (j) => !["finished", "failed", "cancelled"].includes(j.phase)
    );
    const origins = new Set(
      active.map((j) => monitors.find((m) => m.id === j.monitorId)?.origin)
    );
    const now = Date.now();
    const selected = [];
    for (const m of monitors.sort((a, b) => a.nextDueAt - b.nextDueAt)) {
      if (active.length + selected.length >= 2) break;
      if (!m.enabled || ["needs_permission", "needs_attention"].includes(m.health) || m.nextDueAt > now || active.some((j2) => j2.monitorId === m.id) || origins.has(m.origin))
        continue;
      const j = {
        runId: crypto.randomUUID(),
        monitorId: m.id,
        configVersion: m.configVersion,
        phase: "queued",
        startedAt: now,
        deadlineAt: now + 6e4,
        leaseUntil: now + 12e4,
        attempt: m.consecutiveFailures + 1,
        session: session2
      };
      await request(js.add(j));
      m.lastAttemptAt = now;
      await request(ms.put(m));
      selected.push(j);
      origins.add(m.origin);
    }
    return selected;
  });
}
async function mutate(id, action) {
  return transaction(
    ["monitors", "jobs", "snapshots", "changeEvents", "notificationOutbox"],
    async (tx) => {
      const ms = tx.objectStore("monitors"), js = tx.objectStore("jobs");
      const m = await request(ms.get(id));
      if (!m) throw Error("MONITOR_DELETED");
      const now = Date.now();
      if (action === "RUN_NOW" && (await request(js.getAll())).some(
        (j) => j.monitorId === id && !["finished", "failed", "cancelled"].includes(j.phase)
      ))
        return;
      if (action !== "RUN_NOW") {
        m.configVersion++;
        for (const j of await request(js.getAll()))
          if (j.monitorId === id) {
            j.phase = "cancelled";
            await request(js.put(j));
          }
      }
      if (action === "DELETE_MONITOR") {
        await request(ms.delete(id));
        for (const name of ["snapshots", "changeEvents"])
          for (const row of await request(tx.objectStore(name).getAll()))
            if (row.monitorId === id) {
              if (name === "changeEvents")
                await request(
                  tx.objectStore("notificationOutbox").delete(row.id)
                );
              await request(tx.objectStore(name).delete(row.id));
            }
        for (const j of await request(js.getAll()))
          if (j.monitorId === id) await request(js.delete(j.runId));
        return;
      }
      if (action === "PAUSE_MONITOR") m.enabled = false;
      else {
        m.enabled = true;
        m.health = m.baselineSnapshotId ? "healthy" : "initializing";
        m.nextDueAt = now;
        m.lastError = void 0;
        m.consecutiveFailures = 0;
      }
      if (action === "RESET_BASELINE") {
        m.baselineSnapshotId = void 0;
        m.health = "initializing";
      }
      m.updatedAt = now;
      await request(ms.put(m));
    }
  );
}
async function fail(runId, code) {
  await transaction(["jobs", "monitors"], async (tx) => {
    const js = tx.objectStore("jobs"), ms = tx.objectStore("monitors");
    const j = await request(js.get(runId));
    if (!j || ["finished", "failed", "cancelled"].includes(j.phase)) return;
    const m = await request(ms.get(j.monitorId));
    j.phase = ["TAB_CLOSED", "TAB_TAKEN_OVER"].includes(code) ? "cancelled" : "failed";
    j.error = code;
    await request(js.put(j));
    if (!m || m.configVersion !== j.configVersion || !m.enabled) return;
    const now = Date.now();
    if (j.phase === "cancelled") {
      m.nextDueAt = now + m.intervalMinutes * 6e4;
    } else {
      m.consecutiveFailures++;
      const immediate = [
        "LOGIN_OR_ERROR_DETECTED",
        "REDIRECTED_ORIGIN",
        "SNAPSHOT_TOO_LARGE",
        "STORAGE_FULL"
      ];
      const three = [
        "SELECTOR_MISSING",
        "SELECTOR_AMBIGUOUS",
        "EMPTY_CONTENT",
        "UNSTABLE_CONTENT"
      ];
      m.health = code === "PERMISSION_REQUIRED" ? "needs_permission" : immediate.includes(code) || three.includes(code) && m.consecutiveFailures >= 3 || m.consecutiveFailures >= 10 ? "needs_attention" : "retrying";
      m.lastError = {
        code,
        userMessage: errorMessages[code] || code,
        occurredAt: now,
        diagnosticId: crypto.randomUUID()
      };
      m.nextDueAt = now + backoff(m.intervalMinutes, m.consecutiveFailures);
    }
    await request(ms.put(m));
  });
}
async function cleanup(tx, now = Date.now()) {
  const ms = await request(tx.objectStore("monitors").getAll()), es = tx.objectStore("changeEvents"), ss = tx.objectStore("snapshots"), os = tx.objectStore("notificationOutbox");
  const events = await request(es.getAll());
  const keep = /* @__PURE__ */ new Set();
  for (const m of ms) {
    const own = events.filter((e) => e.monitorId === m.id).sort((a, b) => b.detectedAt - a.detectedAt);
    for (const e of own.filter(
      (e2, i) => i < 50 && e2.detectedAt >= now - 30 * 864e5
    ))
      keep.add(e.id);
  }
  for (const e of events)
    if (!keep.has(e.id)) {
      await request(es.delete(e.id));
      await request(os.delete(e.id));
    }
  const refs = new Set(ms.map((m) => m.baselineSnapshotId));
  for (const e of events)
    if (keep.has(e.id)) {
      refs.add(e.beforeSnapshotId);
      refs.add(e.afterSnapshotId);
    }
  for (const s of await request(ss.getAll()))
    if (!refs.has(s.id)) await request(ss.delete(s.id));
}
async function prune() {
  await transaction(
    ["monitors", "snapshots", "changeEvents", "notificationOutbox", "jobs"],
    async (tx) => {
      await cleanup(tx);
      for (const j of await request(tx.objectStore("jobs").getAll()))
        if (["finished", "failed", "cancelled"].includes(j.phase) && j.startedAt < Date.now() - 864e5)
          await request(tx.objectStore("jobs").delete(j.runId));
    }
  );
}
async function clearHistory(monitorId) {
  return transaction(
    ["monitors", "snapshots", "changeEvents", "notificationOutbox"],
    async (tx) => {
      if (!await request(tx.objectStore("monitors").get(monitorId)))
        throw Error("MONITOR_DELETED");
      const events = tx.objectStore("changeEvents");
      for (const event of await request(events.getAll())) {
        if (event.monitorId === monitorId) {
          await request(events.delete(event.id));
          await request(tx.objectStore("notificationOutbox").delete(event.id));
        }
      }
      const refs = new Set(
        (await request(tx.objectStore("monitors").getAll())).map(
          (m) => m.baselineSnapshotId
        )
      );
      for (const event of await request(events.getAll())) {
        refs.add(event.beforeSnapshotId);
        refs.add(event.afterSnapshotId);
      }
      const snapshots = tx.objectStore("snapshots");
      for (const snapshot of await request(snapshots.getAll())) {
        if (snapshot.monitorId === monitorId && !refs.has(snapshot.id))
          await request(snapshots.delete(snapshot.id));
      }
    }
  );
}
async function commit(runId, content, finalUrl) {
  const hash = await digest(content);
  return transaction(
    ["monitors", "jobs", "snapshots", "changeEvents", "notificationOutbox"],
    async (tx) => {
      const js = tx.objectStore("jobs"), ms = tx.objectStore("monitors"), ss = tx.objectStore("snapshots");
      const j = await request(js.get(runId));
      if (!j || ["finished", "failed", "cancelled"].includes(j.phase)) return;
      const m = await request(ms.get(j.monitorId));
      const now = Date.now();
      if (!m || !m.enabled || j.configVersion !== m.configVersion || now > j.leaseUntil || now > j.deadlineAt)
        throw Error("CONFIG_CHANGED");
      if (new URL(finalUrl).origin !== m.origin)
        throw Error("REDIRECTED_ORIGIN");
      const old = m.baselineSnapshotId ? await request(ss.get(m.baselineSnapshotId)) : void 0;
      let event;
      if (!old || changed(old, content)) {
        await cleanup(tx);
        let snapshots = await request(ss.getAll());
        let bytes = snapshots.reduce((n, s2) => n + s2.byteLength, 0);
        if (bytes + hash.byteLength > 50 * 1024 * 1024) {
          const es = tx.objectStore("changeEvents");
          for (const e of (await request(es.getAll())).sort(
            (a, b) => a.detectedAt - b.detectedAt
          )) {
            await request(es.delete(e.id));
            await request(tx.objectStore("notificationOutbox").delete(e.id));
            await cleanup(tx);
            snapshots = await request(ss.getAll());
            bytes = snapshots.reduce((n, s2) => n + s2.byteLength, 0);
            if (bytes + hash.byteLength <= 50 * 1024 * 1024) break;
          }
          if (bytes + hash.byteLength > 50 * 1024 * 1024)
            throw Error("STORAGE_FULL");
        }
        const s = {
          ...content,
          ...hash,
          id: crypto.randomUUID(),
          monitorId: m.id,
          runId,
          configVersion: m.configVersion,
          capturedAt: now,
          finalUrl
        };
        await request(ss.add(s));
        if (old) {
          event = {
            id: crypto.randomUUID(),
            monitorId: m.id,
            runId,
            configVersion: m.configVersion,
            beforeSnapshotId: old.id,
            afterSnapshotId: s.id,
            detectedAt: now,
            summary: "\u6B63\u898F\u5316\u5167\u5BB9\u5DF2\u8B8A\u66F4"
          };
          await request(tx.objectStore("changeEvents").add(event));
          const out = {
            eventId: event.id,
            notificationId: "change:" + m.id + ":" + event.id,
            state: "pending",
            attempts: 0,
            updatedAt: now
          };
          await request(tx.objectStore("notificationOutbox").add(out));
          m.lastChangeAt = now;
        }
        m.baselineSnapshotId = s.id;
      }
      m.lastSuccessAt = now;
      m.nextDueAt = now + m.intervalMinutes * 6e4;
      m.health = "healthy";
      m.consecutiveFailures = 0;
      m.lastError = void 0;
      m.errorNotifiedCode = void 0;
      await request(ms.put(m));
      j.phase = "finished";
      await request(js.put(j));
      await cleanup(tx);
      return event;
    }
  );
}
async function clear() {
  await transaction([...stores], async (tx) => {
    for (const s of stores) await request(tx.objectStore(s).clear());
    await request(
      tx.objectStore("settings").put({
        key: "global",
        schemaVersion: 1,
        notificationsEnabled: true,
        retentionDays: 30,
        maxEventsPerMonitor: 50,
        uiPreferences: {}
      })
    );
  });
}
async function claimNotification(eventId) {
  return transaction(["notificationOutbox"], async (tx) => {
    const s = tx.objectStore("notificationOutbox"), row = await request(s.get(eventId));
    if (!row || row.state === "sent" || row.attempts >= 3 || row.lastError === "IN_FLIGHT" && Date.now() - row.updatedAt < 6e4)
      return;
    row.attempts++;
    row.updatedAt = Date.now();
    row.lastError = "IN_FLIGHT";
    await request(s.put(row));
    return row;
  });
}

// src/background.ts
var terminal = (j) => ["finished", "failed", "cancelled"].includes(j.phase);
var safe = (p) => {
  void p.catch(() => {
  });
};
var sessionReady;
function session() {
  return sessionReady ??= (async () => {
    const value = await chrome.storage.session.get("session");
    if (value.session) return value.session;
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ session: id });
    return id;
  })().catch((e) => {
    sessionReady = void 0;
    throw e;
  });
}
async function patchJob(runId, fn) {
  return transaction(["jobs"], async (tx) => {
    const s = tx.objectStore("jobs"), j = await request(s.get(runId));
    if (j && !terminal(j)) {
      fn(j);
      await request(s.put(j));
    }
    return j;
  });
}
async function closeOwned(j) {
  const current = await get("jobs", j.runId);
  if ((current?.error || j.error) === "TAB_TAKEN_OVER" || (current?.error || j.error) === "REDIRECTED_ORIGIN")
    return;
  if (!j.tabId || j.session !== await session()) return;
  try {
    const tab = await chrome.tabs.get(j.tabId);
    if (tab.active) return;
    const probe = await chrome.tabs.sendMessage(
      j.tabId,
      { type: "PROBE" },
      { frameId: 0 }
    );
    if (probe?.runIds?.includes(j.runId)) {
      await chrome.tabs.remove(j.tabId);
      await transaction(["jobs"], async (tx) => {
        const s = tx.objectStore("jobs"), v = await request(s.get(j.runId));
        if (v && v.tabId === j.tabId) {
          v.tabId = void 0;
          v.documentId = void 0;
          await request(s.put(v));
        }
      });
    }
  } catch {
  }
}
async function badge() {
  const [ms, events] = await Promise.all([
    all("monitors"),
    all("changeEvents")
  ]);
  const errors = ms.filter(
    (m) => m.enabled && (m.consecutiveFailures >= 3 || ["needs_permission", "needs_attention"].includes(m.health))
  ).length;
  const unread = events.filter((e) => !e.readAt).length;
  await chrome.action.setBadgeText({
    text: errors ? "!" : unread ? String(unread) : ""
  });
  await chrome.action.setBadgeBackgroundColor({
    color: errors ? "#ad381c" : "#116f64"
  });
}
async function notify() {
  const settings = await get("settings", "global");
  for (const pending of await all("notificationOutbox")) {
    const row = await claimNotification(pending.eventId);
    if (!row) continue;
    if (row.state === "sent" || row.attempts >= 3) continue;
    const e = await get("changeEvents", row.eventId);
    if (!e) continue;
    const m = await get("monitors", e.monitorId);
    row.updatedAt = Date.now();
    try {
      if (!settings?.notificationsEnabled || !m?.notifications || await chrome.notifications.getPermissionLevel() !== "granted")
        throw Error("DISABLED");
      await chrome.notifications.create(row.notificationId, {
        type: "basic",
        iconUrl: "icon.png",
        title: "DOM \u5340\u57DF\u76E3\u63A7",
        message: `${m.name}\uFF1A\u5075\u6E2C\u5230\u5167\u5BB9\u8B8A\u66F4`
      });
      row.state = "sent";
      row.lastError = void 0;
    } catch (e2) {
      row.state = "failed";
      row.lastError = e2.message === "DISABLED" ? "DISABLED" : "NOTIFICATION_FAILED";
    }
    await put("notificationOutbox", row);
  }
  await badge();
}
async function beginSampling(j) {
  if (!j.tabId || terminal(j)) return;
  const m = await get("monitors", j.monitorId);
  if (!m || !m.enabled || m.configVersion !== j.configVersion) return;
  const tab = await chrome.tabs.get(j.tabId);
  if (tab.active) {
    await fail(j.runId, "TAB_TAKEN_OVER");
    return;
  }
  if (!tab.url || new URL(tab.url).origin !== m.origin) {
    await fail(j.runId, "REDIRECTED_ORIGIN");
    return;
  }
  if (!await chrome.permissions.contains({ origins: [m.origin + "/*"] })) {
    await fail(j.runId, "PERMISSION_REQUIRED");
    return;
  }
  const injected = await chrome.scripting.executeScript({
    target: { tabId: j.tabId, frameIds: [0] },
    world: "ISOLATED",
    files: ["capture.js"]
  });
  const documentId = injected[0]?.documentId;
  if (!documentId) throw Error("WORKER_INTERRUPTED");
  await patchJob(j.runId, (x) => {
    x.documentId = documentId;
    x.phase = "sampling";
  });
  await chrome.tabs.sendMessage(
    j.tabId,
    {
      type: "CAPTURE_START",
      config: m,
      runId: j.runId,
      monitorId: m.id,
      configVersion: m.configVersion,
      deadlineAt: j.deadlineAt
    },
    { documentId }
  );
}
async function launch(j) {
  const claimed = await transaction(["jobs"], async (tx) => {
    const s = tx.objectStore("jobs"), current = await request(s.get(j.runId));
    if (!current || current.phase !== "queued") return false;
    current.phase = "opening";
    await request(s.put(current));
    return true;
  });
  if (!claimed) return;
  try {
    const m = await get("monitors", j.monitorId);
    if (!m) return;
    if (!await chrome.permissions.contains({ origins: [m.origin + "/*"] })) {
      await fail(j.runId, "PERMISSION_REQUIRED");
      return;
    }
    await patchJob(j.runId, (x) => {
      x.phase = "opening";
    });
    const tab = await chrome.tabs.create({ url: m.url, active: false });
    const current = await patchJob(j.runId, (x) => {
      x.tabId = tab.id;
      x.phase = "loading";
    });
    if (!current || terminal(current)) return;
    if (tab.status === "complete") await beginSampling(current);
  } catch (e) {
    await fail(
      j.runId,
      e.message === "PERMISSION_REQUIRED" ? "PERMISSION_REQUIRED" : "LOAD_TIMEOUT"
    );
  }
}
async function dispatch() {
  await ensureAlarm();
  const sid = await session();
  for (const j of await all("jobs")) {
    if (terminal(j)) {
      await closeOwned(j);
      continue;
    }
    if (j.session !== sid || Date.now() > j.deadlineAt || Date.now() > j.leaseUntil) {
      await fail(
        j.runId,
        j.session !== sid ? "WORKER_INTERRUPTED" : "LOAD_TIMEOUT"
      );
      await closeOwned(j);
      continue;
    }
    if (j.tabId) {
      try {
        const t = await chrome.tabs.get(j.tabId);
        if (t.active) {
          await fail(j.runId, "TAB_TAKEN_OVER");
          continue;
        }
        if (t.status === "complete" && ["loading", "opening", "sampling"].includes(j.phase))
          await beginSampling(j);
      } catch {
        await fail(j.runId, "TAB_CLOSED");
      }
    } else if (j.phase === "queued") safe(launch(j));
    else if (j.phase !== "opening")
      await fail(j.runId, "WORKER_INTERRUPTED");
  }
  for (const j of await acquire(sid)) safe(launch(j));
  await prune();
  await errorNotices();
  await notify();
}
async function ensureAlarm() {
  if (!await chrome.alarms.get("dispatcher"))
    await chrome.alarms.create("dispatcher", { periodInMinutes: 1 });
}
function uiSender(sender) {
  return sender.id === chrome.runtime.id && !!sender.url && ["dashboard.html", "popup.html"].some((p) => {
    const u = new URL(sender.url);
    return u.protocol === "chrome-extension:" && u.host === chrome.runtime.id && u.pathname === "/" + p;
  });
}
function validContent(raw, m) {
  if (!raw || raw.normalizationVersion !== 1 || JSON.stringify(raw.captureOptions) !== JSON.stringify(m.captureOptions) || !Array.isArray(raw.textBlocks) || !raw.textBlocks.every((s) => typeof s === "string") || !Array.isArray(raw.links) || !raw.links.every(
    (v) => v && typeof v.href === "string" && typeof v.text === "string"
  ) || !Array.isArray(raw.images) || !raw.images.every(
    (v) => v && typeof v.src === "string" && typeof v.alt === "string"
  ))
    throw Error("INVALID_CONTENT");
  const c = {
    normalizationVersion: 1,
    captureOptions: m.captureOptions,
    textBlocks: raw.textBlocks,
    links: raw.links.map((v) => ({ href: v.href, text: v.text })),
    images: raw.images.map((v) => ({ src: v.src, alt: v.alt }))
  };
  if (new TextEncoder().encode(canonical(c)).length > LIMIT)
    throw Error("SNAPSHOT_TOO_LARGE");
  if (!m.allowEmpty && !c.textBlocks.length && !c.links.length && !c.images.length)
    throw Error("EMPTY_CONTENT");
  return c;
}
async function handle(raw, sender) {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string" || sender.id !== chrome.runtime.id)
    throw Error("INVALID_MESSAGE");
  if (["CAPTURE_RESULT", "CAPTURE_ERROR"].includes(raw.type)) {
    const j = typeof raw.runId === "string" ? await get("jobs", raw.runId) : void 0;
    if (!j || terminal(j) || sender.tab?.id !== j.tabId || sender.frameId !== 0 || !j.documentId || sender.documentId !== j.documentId || raw.monitorId !== j.monitorId || raw.configVersion !== j.configVersion || j.session !== await session())
      throw Error("INVALID_SENDER");
    const m = await get("monitors", j.monitorId);
    if (!m || m.configVersion !== j.configVersion || !m.enabled) return;
    const tab = await chrome.tabs.get(j.tabId);
    if (tab.active) {
      await fail(j.runId, "TAB_TAKEN_OVER");
      return;
    }
    if (!await chrome.permissions.contains({ origins: [m.origin + "/*"] })) {
      await fail(j.runId, "PERMISSION_REQUIRED");
      await closeOwned(j);
      return;
    }
    try {
      if (raw.type === "CAPTURE_ERROR") {
        const allowed = [
          "LOAD_TIMEOUT",
          "SELECTOR_MISSING",
          "SELECTOR_AMBIGUOUS",
          "UNSTABLE_CONTENT",
          "EMPTY_CONTENT",
          "LOGIN_OR_ERROR_DETECTED",
          "SNAPSHOT_TOO_LARGE"
        ];
        await fail(
          j.runId,
          allowed.includes(raw.code) ? raw.code : "INVALID_SELECTOR"
        );
      } else {
        if (typeof raw.finalUrl !== "string" || raw.finalUrl !== sender.url || new URL(raw.finalUrl).origin !== m.origin)
          throw Error("REDIRECTED_ORIGIN");
        await commit(j.runId, validContent(raw.content, m), raw.finalUrl);
      }
    } catch (e) {
      await fail(
        j.runId,
        e.name === "QuotaExceededError" ? "STORAGE_FULL" : e.message
      );
    }
    await closeOwned(j);
    await notify();
    safe(dispatch());
    return;
  }
  if (raw.type === "PICKED") {
    if (!sender.tab?.id || sender.frameId !== 0 || typeof raw.selector !== "string" || !sender.url)
      throw Error("INVALID_SENDER");
    const pickerContext = await chrome.storage.session.get(
      "picker:" + sender.tab.id
    );
    const draft = {
      monitorId: pickerContext["picker:" + sender.tab.id]?.monitorId,
      tabId: sender.tab.id,
      url: urlOf(sender.url).href,
      selector: raw.selector,
      ignoreSelectors: raw.ignoreSelectors || []
    };
    await chrome.storage.session.set({ draft });
    await chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard.html#new")
    });
    return;
  }
  if (!uiSender(sender)) throw Error("INVALID_SENDER");
  if (raw.type === "STATE")
    return {
      monitors: await all("monitors"),
      events: await all("changeEvents"),
      snapshots: await all("snapshots"),
      jobs: await all("jobs"),
      outbox: await all("notificationOutbox"),
      settings: await get("settings", "global"),
      draft: (await chrome.storage.session.get("draft")).draft
    };
  if (raw.type === "START_PICKER") {
    let id = raw.tabId;
    if (id === void 0)
      id = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!Number.isInteger(id)) throw Error("UNSUPPORTED_URL");
    await chrome.storage.session.set({
      ["picker:" + id]: {
        monitorId: typeof raw.monitorId === "string" ? raw.monitorId : void 0
      }
    });
    const t = await chrome.tabs.get(id);
    urlOf(t.url || "");
    if (t.incognito) throw Error("UNSUPPORTED_URL");
    await chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      world: "ISOLATED",
      files: ["picker.js"]
    });
    return;
  }
  if (raw.type === "PREVIEW_SELECTION") {
    const c = config(raw.config);
    if (!Number.isInteger(raw.tabId)) throw Error("INVALID_TAB");
    const tab = await chrome.tabs.get(raw.tabId);
    if (!tab.url || new URL(tab.url).origin !== c.origin)
      throw Error("REDIRECTED_ORIGIN");
    await chrome.scripting.executeScript({
      target: { tabId: raw.tabId, frameIds: [0] },
      world: "ISOLATED",
      files: ["capture.js"]
    });
    return chrome.tabs.sendMessage(
      raw.tabId,
      { type: "PREVIEW", config: c },
      { frameId: 0 }
    );
  }
  if (["CREATE_MONITOR", "UPDATE_MONITOR"].includes(raw.type)) {
    const c = config(raw.config);
    if (!await chrome.permissions.contains({ origins: [c.origin + "/*"] }))
      throw Error("PERMISSION_REQUIRED");
    const m = await save(
      c,
      raw.type === "UPDATE_MONITOR" ? raw.id : void 0
    );
    await chrome.storage.session.remove("draft");
    safe(dispatch());
    return m;
  }
  if ([
    "RUN_NOW",
    "PAUSE_MONITOR",
    "RESUME_MONITOR",
    "DELETE_MONITOR",
    "RESET_BASELINE"
  ].includes(raw.type)) {
    if (typeof raw.id !== "string") throw Error("INVALID_ID");
    const jobs = (await all("jobs")).filter(
      (j) => j.monitorId === raw.id && !terminal(j)
    );
    await mutate(raw.id, raw.type);
    if (raw.type !== "RUN_NOW") for (const j of jobs) await closeOwned(j);
    safe(dispatch());
    return;
  }
  if (raw.type === "MARK_ALL_EVENTS_READ") {
    if (typeof raw.monitorId !== "string" || !raw.monitorId)
      throw Error("INVALID_ID");
    await transaction(["changeEvents"], async (tx) => {
      const store = tx.objectStore("changeEvents");
      const readAt = Date.now();
      for (const event of await request(store.getAll())) {
        if (event.monitorId === raw.monitorId && !event.readAt) {
          event.readAt = readAt;
          await request(store.put(event));
        }
      }
    });
    await badge();
    return;
  }
  if (raw.type === "CLEAR_HISTORY") {
    if (typeof raw.monitorId !== "string" || !raw.monitorId)
      throw Error("INVALID_ID");
    await clearHistory(raw.monitorId);
    await badge();
    return;
  }
  if (raw.type === "MARK_EVENT_READ") {
    await transaction(["changeEvents"], async (tx) => {
      const s = tx.objectStore("changeEvents"), e = await request(s.get(raw.id));
      if (e) {
        e.readAt = Date.now();
        await request(s.put(e));
      }
    });
    await badge();
    return;
  }
  if (raw.type === "SETTINGS") {
    if (typeof raw.notificationsEnabled !== "boolean")
      throw Error("INVALID_SETTINGS");
    const s = await get("settings", "global");
    await put("settings", {
      ...s,
      notificationsEnabled: raw.notificationsEnabled
    });
    return;
  }
  if (raw.type === "CLEAR_ALL") {
    const jobs = await all("jobs");
    await clear();
    for (const j of jobs) await closeOwned(j);
    await chrome.storage.session.remove("draft");
    await badge();
    return;
  }
  throw Error("UNKNOWN_MESSAGE");
}
chrome.runtime.onMessage.addListener((raw, sender, reply) => {
  handle(raw, sender).then(
    (value) => reply({ ok: true, value }),
    (e) => reply({ ok: false, error: e.message })
  );
  return true;
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "dispatcher") safe(dispatch());
});
chrome.runtime.onInstalled.addListener(() => safe(dispatch()));
chrome.runtime.onStartup.addListener(() => safe(dispatch()));
chrome.tabs.onUpdated.addListener(
  (tabId, change) => safe(
    (async () => {
      for (const j of await all("jobs"))
        if (j.tabId === tabId && !terminal(j)) {
          if (change.status === "loading" && j.phase === "sampling") {
            await fail(j.runId, "TAB_TAKEN_OVER");
            continue;
          }
          const m = await get("monitors", j.monitorId);
          if (change.url && m) {
            if (new URL(change.url).origin !== m.origin) {
              await fail(j.runId, "REDIRECTED_ORIGIN");
              continue;
            }
            if (j.phase === "sampling") {
              await fail(j.runId, "TAB_TAKEN_OVER");
              continue;
            }
          }
          if (change.status === "complete" && j.phase === "loading")
            await beginSampling(j);
        }
    })()
  )
);
chrome.tabs.onActivated.addListener(
  ({ tabId }) => safe(
    (async () => {
      for (const j of await all("jobs"))
        if (j.tabId === tabId && !terminal(j))
          await fail(j.runId, "TAB_TAKEN_OVER");
    })()
  )
);
chrome.tabs.onRemoved.addListener(
  (tabId) => safe(
    (async () => {
      for (const j of await all("jobs"))
        if (j.tabId === tabId && !terminal(j))
          await fail(j.runId, "TAB_CLOSED");
    })()
  )
);
chrome.permissions.onRemoved.addListener(
  () => safe(
    (async () => {
      for (const m of await all("monitors"))
        if (!await chrome.permissions.contains({ origins: [m.origin + "/*"] })) {
          await transaction(["monitors", "jobs"], async (tx) => {
            const s = tx.objectStore("monitors");
            const current = await request(s.get(m.id));
            if (!current) return;
            current.health = "needs_permission";
            current.configVersion++;
            await request(s.put(current));
            for (const j of await request(
              tx.objectStore("jobs").getAll()
            ))
              if (j.monitorId === m.id && !terminal(j)) {
                j.phase = "cancelled";
                await request(tx.objectStore("jobs").put(j));
              }
          });
        }
      await badge();
    })()
  )
);
chrome.notifications.onClicked.addListener(
  (id) => safe(
    (async () => {
      if (!id.startsWith("change:")) return;
      await chrome.tabs.create({
        url: chrome.runtime.getURL(
          "dashboard.html#event=" + encodeURIComponent(id.split(":").at(-1)) + "&monitor=" + encodeURIComponent(
            id.split(":").length === 3 ? id.split(":")[1] : ""
          )
        )
      });
    })()
  )
);
safe(chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
safe(dispatch());
async function errorNotices() {
  const settings = await get("settings", "global");
  if (!settings?.notificationsEnabled) return;
  for (const m of await all("monitors")) {
    if (!m.enabled || !m.notifications || !m.lastError || m.errorNotifiedCode === m.lastError.code)
      continue;
    const claimed = await transaction(["monitors"], async (tx) => {
      const s = tx.objectStore("monitors"), v = await request(s.get(m.id));
      if (!v?.lastError || v.errorNotifiedCode === v.lastError.code)
        return false;
      v.errorNotifiedCode = v.lastError.code;
      await request(s.put(v));
      return true;
    });
    if (claimed)
      try {
        await chrome.notifications.create("error:" + m.id, {
          type: "basic",
          iconUrl: "icon.png",
          title: "DOM \u5340\u57DF\u76E3\u63A7\uFF1A\u6AA2\u67E5\u932F\u8AA4",
          message: m.name + "\uFF1A" + m.lastError.userMessage
        });
      } catch {
      }
  }
}
//# sourceMappingURL=background.js.map
