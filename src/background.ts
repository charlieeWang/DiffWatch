import {
  config,
  urlOf,
  LIMIT,
  canonical,
  type Monitor,
  type Job,
  type Content,
  type Snapshot,
  type ChangeEvent,
  type Outbox,
} from "./core";
import * as db from "./storage";
const terminal = (j: Job) =>
  ["finished", "failed", "cancelled"].includes(j.phase);
const safe = (p: Promise<unknown>) => {
  void p.catch(() => {
    /* No page content or query strings in logs. */
  });
};
let sessionReady: Promise<string> | undefined;
function session() {
  return (sessionReady ??= (async () => {
    const value = await chrome.storage.session.get("session");
    if (value.session) return value.session as string;
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ session: id });
    return id;
  })().catch((e) => {
    sessionReady = undefined;
    throw e;
  }));
}
async function patchJob(runId: string, fn: (j: Job) => void) {
  return db.transaction(["jobs"], async (tx) => {
    const s = tx.objectStore("jobs"),
      j = await db.request<Job | undefined>(s.get(runId));
    if (j && !terminal(j)) {
      fn(j);
      await db.request(s.put(j));
    }
    return j;
  });
}
async function closeOwned(j: Job) {
  const current = await db.get<Job>("jobs", j.runId);
  if (
    (current?.error || j.error) === "TAB_TAKEN_OVER" ||
    (current?.error || j.error) === "REDIRECTED_ORIGIN"
  )
    return;
  if (!j.tabId || j.session !== (await session())) return;
  try {
    const tab = await chrome.tabs.get(j.tabId);
    if (tab.active) return;
    const probe = await chrome.tabs.sendMessage(
      j.tabId,
      { type: "PROBE" },
      { frameId: 0 },
    );
    if (probe?.runIds?.includes(j.runId)) {
      await chrome.tabs.remove(j.tabId);
      await db.transaction(["jobs"], async (tx) => {
        const s = tx.objectStore("jobs"),
          v = await db.request<Job | undefined>(s.get(j.runId));
        if (v && v.tabId === j.tabId) {
          v.tabId = undefined;
          v.documentId = undefined;
          await db.request(s.put(v));
        }
      });
    }
  } catch {}
}
async function badge() {
  const [ms, events] = await Promise.all([
    db.all<Monitor>("monitors"),
    db.all<ChangeEvent>("changeEvents"),
  ]);
  const errors = ms.filter(
    (m) =>
      m.enabled &&
      (m.consecutiveFailures >= 3 ||
        ["needs_permission", "needs_attention"].includes(m.health)),
  ).length;
  const unread = events.filter((e) => !e.readAt).length;
  await chrome.action.setBadgeText({
    text: errors ? "!" : unread ? String(unread) : "",
  });
  await chrome.action.setBadgeBackgroundColor({
    color: errors ? "#ad381c" : "#116f64",
  });
}
async function notify() {
  const settings = await db.get<any>("settings", "global");
  for (const pending of await db.all<Outbox>("notificationOutbox")) {
    const row = await db.claimNotification(pending.eventId);
    if (!row) continue;
    if (row.state === "sent" || row.attempts >= 3) continue;
    const e = await db.get<ChangeEvent>("changeEvents", row.eventId);
    if (!e) continue;
    const m = await db.get<Monitor>("monitors", e.monitorId);

    row.updatedAt = Date.now();
    try {
      if (
        !settings?.notificationsEnabled ||
        !m?.notifications ||
        (await chrome.notifications.getPermissionLevel()) !== "granted"
      )
        throw Error("DISABLED");
      await chrome.notifications.create(row.notificationId, {
        type: "basic",
        iconUrl: "icon.png",
        title: "DOM 區域監控",
        message: `${m.name}：偵測到內容變更`,
      });
      row.state = "sent";
      row.lastError = undefined;
    } catch (e) {
      row.state = "failed";
      row.lastError =
        (e as Error).message === "DISABLED"
          ? "DISABLED"
          : "NOTIFICATION_FAILED";
    }
    await db.put("notificationOutbox", row);
  }
  await badge();
}
async function beginSampling(j: Job) {
  if (!j.tabId || terminal(j)) return;
  const m = await db.get<Monitor>("monitors", j.monitorId);
  if (!m || !m.enabled || m.configVersion !== j.configVersion) return;
  const tab = await chrome.tabs.get(j.tabId);
  if (tab.active) {
    await db.fail(j.runId, "TAB_TAKEN_OVER");
    return;
  }
  if (!tab.url || new URL(tab.url).origin !== m.origin) {
    await db.fail(j.runId, "REDIRECTED_ORIGIN");
    return;
  }
  if (!(await chrome.permissions.contains({ origins: [m.origin + "/*"] }))) {
    await db.fail(j.runId, "PERMISSION_REQUIRED");
    return;
  }
  // Injection returns immediately; sampling completion wakes a fresh worker event.
  const injected = await chrome.scripting.executeScript({
    target: { tabId: j.tabId, frameIds: [0] },
    world: "ISOLATED",
    files: ["capture.js"],
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
      deadlineAt: j.deadlineAt,
    },
    { documentId },
  );
}
async function launch(j: Job) {
  const claimed = await db.transaction(["jobs"], async (tx) => {
    const s = tx.objectStore("jobs"),
      current = await db.request<Job | undefined>(s.get(j.runId));
    if (!current || current.phase !== "queued") return false;
    current.phase = "opening";
    await db.request(s.put(current));
    return true;
  });
  if (!claimed) return;
  try {
    const m = await db.get<Monitor>("monitors", j.monitorId);
    if (!m) return;
    if (!(await chrome.permissions.contains({ origins: [m.origin + "/*"] }))) {
      await db.fail(j.runId, "PERMISSION_REQUIRED");
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
    await db.fail(
      j.runId,
      (e as Error).message === "PERMISSION_REQUIRED"
        ? "PERMISSION_REQUIRED"
        : "LOAD_TIMEOUT",
    );
  }
}
async function dispatch() {
  await ensureAlarm();
  const sid = await session();
  for (const j of await db.all<Job>("jobs")) {
    if (terminal(j)) {
      await closeOwned(j);
      continue;
    }
    if (
      j.session !== sid ||
      Date.now() > j.deadlineAt ||
      Date.now() > j.leaseUntil
    ) {
      await db.fail(
        j.runId,
        j.session !== sid ? "WORKER_INTERRUPTED" : "LOAD_TIMEOUT",
      );
      await closeOwned(j);
      continue;
    }
    if (j.tabId) {
      try {
        const t = await chrome.tabs.get(j.tabId);
        if (t.active) {
          await db.fail(j.runId, "TAB_TAKEN_OVER");
          continue;
        }
        if (
          t.status === "complete" &&
          ["loading", "opening", "sampling"].includes(j.phase)
        )
          await beginSampling(j);
      } catch {
        await db.fail(j.runId, "TAB_CLOSED");
      }
    } else if (j.phase === "queued") safe(launch(j));
    // Another dispatcher may observe a launch between its atomic claim and
    // tabs.create completing. The persisted deadline handles abandoned launches.
    else if (j.phase !== "opening")
      await db.fail(j.runId, "WORKER_INTERRUPTED");
  }
  for (const j of await db.acquire(sid)) safe(launch(j));
  await db.prune();
  await errorNotices();
  await notify();
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get("dispatcher")))
    await chrome.alarms.create("dispatcher", { periodInMinutes: 1 });
}
function uiSender(sender: chrome.runtime.MessageSender) {
  return (
    sender.id === chrome.runtime.id &&
    !!sender.url &&
    ["dashboard.html", "popup.html"].some((p) => {
      const u = new URL(sender.url!);
      return (
        u.protocol === "chrome-extension:" &&
        u.host === chrome.runtime.id &&
        u.pathname === "/" + p
      );
    })
  );
}
function validContent(raw: any, m: Monitor): Content {
  if (
    !raw ||
    raw.normalizationVersion !== 1 ||
    JSON.stringify(raw.captureOptions) !== JSON.stringify(m.captureOptions) ||
    !Array.isArray(raw.textBlocks) ||
    !raw.textBlocks.every((s: unknown) => typeof s === "string") ||
    !Array.isArray(raw.links) ||
    !raw.links.every(
      (v: any) => v && typeof v.href === "string" && typeof v.text === "string",
    ) ||
    !Array.isArray(raw.images) ||
    !raw.images.every(
      (v: any) => v && typeof v.src === "string" && typeof v.alt === "string",
    )
  )
    throw Error("INVALID_CONTENT");
  const c: Content = {
    normalizationVersion: 1,
    captureOptions: m.captureOptions,
    textBlocks: raw.textBlocks,
    links: raw.links.map((v: any) => ({ href: v.href, text: v.text })),
    images: raw.images.map((v: any) => ({ src: v.src, alt: v.alt })),
  };
  if (new TextEncoder().encode(canonical(c)).length > LIMIT)
    throw Error("SNAPSHOT_TOO_LARGE");
  if (
    !m.allowEmpty &&
    !c.textBlocks.length &&
    !c.links.length &&
    !c.images.length
  )
    throw Error("EMPTY_CONTENT");
  return c;
}
async function handle(raw: any, sender: chrome.runtime.MessageSender) {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.type !== "string" ||
    sender.id !== chrome.runtime.id
  )
    throw Error("INVALID_MESSAGE");
  if (["CAPTURE_RESULT", "CAPTURE_ERROR"].includes(raw.type)) {
    const j =
      typeof raw.runId === "string"
        ? await db.get<Job>("jobs", raw.runId)
        : undefined;
    if (
      !j ||
      terminal(j) ||
      sender.tab?.id !== j.tabId ||
      sender.frameId !== 0 ||
      !j.documentId ||
      sender.documentId !== j.documentId ||
      raw.monitorId !== j.monitorId ||
      raw.configVersion !== j.configVersion ||
      j.session !== (await session())
    )
      throw Error("INVALID_SENDER");
    const m = await db.get<Monitor>("monitors", j.monitorId);
    if (!m || m.configVersion !== j.configVersion || !m.enabled) return;
    const tab = await chrome.tabs.get(j.tabId!);
    if (tab.active) {
      await db.fail(j.runId, "TAB_TAKEN_OVER");
      return;
    }
    if (!(await chrome.permissions.contains({ origins: [m.origin + "/*"] }))) {
      await db.fail(j.runId, "PERMISSION_REQUIRED");
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
          "SNAPSHOT_TOO_LARGE",
        ];
        await db.fail(
          j.runId,
          allowed.includes(raw.code) ? raw.code : "INVALID_SELECTOR",
        );
      } else {
        if (
          typeof raw.finalUrl !== "string" ||
          raw.finalUrl !== sender.url ||
          new URL(raw.finalUrl).origin !== m.origin
        )
          throw Error("REDIRECTED_ORIGIN");
        await db.commit(j.runId, validContent(raw.content, m), raw.finalUrl);
      }
    } catch (e) {
      await db.fail(
        j.runId,
        (e as Error).name === "QuotaExceededError"
          ? "STORAGE_FULL"
          : (e as Error).message,
      );
    }
    await closeOwned(j);
    await notify();
    safe(dispatch());
    return;
  }
  if (raw.type === "PICKED") {
    if (
      !sender.tab?.id ||
      sender.frameId !== 0 ||
      typeof raw.selector !== "string" ||
      !sender.url
    )
      throw Error("INVALID_SENDER");
    const pickerContext = await chrome.storage.session.get(
      "picker:" + sender.tab.id,
    );
    const draft = {
      monitorId: pickerContext["picker:" + sender.tab.id]?.monitorId,
      tabId: sender.tab.id,
      url: urlOf(sender.url).href,
      selector: raw.selector,
      ignoreSelectors: raw.ignoreSelectors || [],
    };
    await chrome.storage.session.set({ draft });
    await chrome.tabs.create({
      url: chrome.runtime.getURL("dashboard.html#new"),
    });
    return;
  }
  if (!uiSender(sender)) throw Error("INVALID_SENDER");
  if (raw.type === "STATE")
    return {
      monitors: await db.all<Monitor>("monitors"),
      events: await db.all<ChangeEvent>("changeEvents"),
      snapshots: await db.all<Snapshot>("snapshots"),
      jobs: await db.all<Job>("jobs"),
      outbox: await db.all<Outbox>("notificationOutbox"),
      settings: await db.get("settings", "global"),
      draft: (await chrome.storage.session.get("draft")).draft,
    };
  if (raw.type === "START_PICKER") {
    let id = raw.tabId;
    if (id === undefined)
      id = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
        ?.id;
    if (!Number.isInteger(id)) throw Error("UNSUPPORTED_URL");
    await chrome.storage.session.set({
      ["picker:" + id]: {
        monitorId:
          typeof raw.monitorId === "string" ? raw.monitorId : undefined,
      },
    });
    const t = await chrome.tabs.get(id);
    urlOf(t.url || "");
    if (t.incognito) throw Error("UNSUPPORTED_URL");
    await chrome.scripting.executeScript({
      target: { tabId: id, frameIds: [0] },
      world: "ISOLATED",
      files: ["picker.js"],
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
      files: ["capture.js"],
    });
    return chrome.tabs.sendMessage(
      raw.tabId,
      { type: "PREVIEW", config: c },
      { frameId: 0 },
    );
  }
  if (["CREATE_MONITOR", "UPDATE_MONITOR"].includes(raw.type)) {
    const c = config(raw.config);
    if (!(await chrome.permissions.contains({ origins: [c.origin + "/*"] })))
      throw Error("PERMISSION_REQUIRED");
    const m = await db.save(
      c,
      raw.type === "UPDATE_MONITOR" ? raw.id : undefined,
    );
    await chrome.storage.session.remove("draft");
    safe(dispatch());
    return m;
  }
  if (
    [
      "RUN_NOW",
      "PAUSE_MONITOR",
      "RESUME_MONITOR",
      "DELETE_MONITOR",
      "RESET_BASELINE",
    ].includes(raw.type)
  ) {
    if (typeof raw.id !== "string") throw Error("INVALID_ID");
    const jobs = (await db.all<Job>("jobs")).filter(
      (j) => j.monitorId === raw.id && !terminal(j),
    );
    await db.mutate(raw.id, raw.type);
    if (raw.type !== "RUN_NOW") for (const j of jobs) await closeOwned(j);
    safe(dispatch());
    return;
  }
  if (raw.type === "MARK_ALL_EVENTS_READ") {
    if (typeof raw.monitorId !== "string" || !raw.monitorId)
      throw Error("INVALID_ID");
    await db.transaction(["changeEvents"], async (tx) => {
      const store = tx.objectStore("changeEvents");
      const readAt = Date.now();
      for (const event of await db.request<ChangeEvent[]>(store.getAll())) {
        if (event.monitorId === raw.monitorId && !event.readAt) {
          event.readAt = readAt;
          await db.request(store.put(event));
        }
      }
    });
    await badge();
    return;
  }
  if (raw.type === "CLEAR_HISTORY") {
    if (typeof raw.monitorId !== "string" || !raw.monitorId)
      throw Error("INVALID_ID");
    await db.clearHistory(raw.monitorId);
    await badge();
    return;
  }
  if (raw.type === "MARK_EVENT_READ") {
    await db.transaction(["changeEvents"], async (tx) => {
      const s = tx.objectStore("changeEvents"),
        e = await db.request<ChangeEvent | undefined>(s.get(raw.id));
      if (e) {
        e.readAt = Date.now();
        await db.request(s.put(e));
      }
    });
    await badge();
    return;
  }
  if (raw.type === "SETTINGS") {
    if (typeof raw.notificationsEnabled !== "boolean")
      throw Error("INVALID_SETTINGS");
    const s = await db.get<any>("settings", "global");
    await db.put("settings", {
      ...s,
      notificationsEnabled: raw.notificationsEnabled,
    });
    return;
  }
  if (raw.type === "CLEAR_ALL") {
    const jobs = await db.all<Job>("jobs");
    await db.clear();
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
    (e) => reply({ ok: false, error: (e as Error).message }),
  );
  return true;
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "dispatcher") safe(dispatch());
});
chrome.runtime.onInstalled.addListener(() => safe(dispatch()));
chrome.runtime.onStartup.addListener(() => safe(dispatch()));
chrome.tabs.onUpdated.addListener((tabId, change) =>
  safe(
    (async () => {
      for (const j of await db.all<Job>("jobs"))
        if (j.tabId === tabId && !terminal(j)) {
          if (change.status === "loading" && j.phase === "sampling") {
            await db.fail(j.runId, "TAB_TAKEN_OVER");
            continue;
          }
          const m = await db.get<Monitor>("monitors", j.monitorId);
          if (change.url && m) {
            if (new URL(change.url).origin !== m.origin) {
              await db.fail(j.runId, "REDIRECTED_ORIGIN");
              continue;
            }
            if (j.phase === "sampling") {
              await db.fail(j.runId, "TAB_TAKEN_OVER");
              continue;
            }
          }
          if (change.status === "complete" && j.phase === "loading")
            await beginSampling(j);
        }
    })(),
  ),
);
chrome.tabs.onActivated.addListener(({ tabId }) =>
  safe(
    (async () => {
      for (const j of await db.all<Job>("jobs"))
        if (j.tabId === tabId && !terminal(j))
          await db.fail(j.runId, "TAB_TAKEN_OVER");
    })(),
  ),
);
chrome.tabs.onRemoved.addListener((tabId) =>
  safe(
    (async () => {
      for (const j of await db.all<Job>("jobs"))
        if (j.tabId === tabId && !terminal(j))
          await db.fail(j.runId, "TAB_CLOSED");
    })(),
  ),
);
chrome.permissions.onRemoved.addListener(() =>
  safe(
    (async () => {
      for (const m of await db.all<Monitor>("monitors"))
        if (
          !(await chrome.permissions.contains({ origins: [m.origin + "/*"] }))
        ) {
          await db.transaction(["monitors", "jobs"], async (tx) => {
            const s = tx.objectStore("monitors");
            const current = await db.request<Monitor | undefined>(s.get(m.id));
            if (!current) return;
            current.health = "needs_permission";
            current.configVersion++;
            await db.request(s.put(current));
            for (const j of await db.request<Job[]>(
              tx.objectStore("jobs").getAll(),
            ))
              if (j.monitorId === m.id && !terminal(j)) {
                j.phase = "cancelled";
                await db.request(tx.objectStore("jobs").put(j));
              }
          });
        }
      await badge();
    })(),
  ),
);
chrome.notifications.onClicked.addListener((id) =>
  safe(
    (async () => {
      if (!id.startsWith("change:")) return;
      await chrome.tabs.create({
        url: chrome.runtime.getURL(
          "dashboard.html#event=" +
            encodeURIComponent(id.split(":").at(-1)!) +
            "&monitor=" +
            encodeURIComponent(
              id.split(":").length === 3 ? id.split(":")[1] : "",
            ),
        ),
      });
    })(),
  ),
);
safe(chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }));
safe(dispatch());

async function errorNotices() {
  const settings = await db.get<any>("settings", "global");
  if (!settings?.notificationsEnabled) return;
  for (const m of await db.all<Monitor>("monitors")) {
    if (
      !m.enabled ||
      !m.notifications ||
      !m.lastError ||
      m.errorNotifiedCode === m.lastError.code
    )
      continue;
    const claimed = await db.transaction(["monitors"], async (tx) => {
      const s = tx.objectStore("monitors"),
        v = await db.request<Monitor | undefined>(s.get(m.id));
      if (!v?.lastError || v.errorNotifiedCode === v.lastError.code)
        return false;
      v.errorNotifiedCode = v.lastError.code;
      await db.request(s.put(v));
      return true;
    });
    if (claimed)
      try {
        await chrome.notifications.create("error:" + m.id, {
          type: "basic",
          iconUrl: "icon.png",
          title: "DOM 區域監控：檢查錯誤",
          message: m.name + "：" + m.lastError.userMessage,
        });
      } catch {}
  }
}
