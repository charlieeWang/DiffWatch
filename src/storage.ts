import {
  errorMessages,
  backoff,
  changed,
  config,
  digest,
  type Monitor,
  type Snapshot,
  type Job,
  type ChangeEvent,
  type Outbox,
  type Content,
} from "./core";
export const stores = [
  "monitors",
  "snapshots",
  "changeEvents",
  "jobs",
  "notificationOutbox",
  "settings",
] as const;
export type Store = (typeof stores)[number];
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("dom-watch", 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const name of stores) {
        const keyPath =
          name === "jobs"
            ? "runId"
            : name === "notificationOutbox"
              ? "eventId"
              : name === "settings"
                ? "key"
                : "id";
        const s = db.createObjectStore(name, { keyPath });
        if (name === "changeEvents")
          s.createIndex("runId", "runId", { unique: true });
      }
      r.transaction!.objectStore("settings").put({
        key: "global",
        schemaVersion: 1,
        notificationsEnabled: true,
        retentionDays: 30,
        maxEventsPerMonitor: 50,
        uiPreferences: {},
      });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error("DATABASE_BLOCKED"));
  });
}
export const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export async function transaction<T>(
  names: Store[],
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDB();
  const tx = db.transaction(names, "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || Error("TRANSACTION_ABORTED"));
    tx.onerror = () => {};
  });
  try {
    const value = await fn(tx);
    await done;
    return value;
  } catch (e) {
    try {
      tx.abort();
    } catch {}
    await done.catch(() => {});
    throw e;
  } finally {
    db.close();
  }
}
export async function all<T>(name: Store): Promise<T[]> {
  return transaction([name], (tx) => request(tx.objectStore(name).getAll()));
}
export async function get<T>(name: Store, id: string): Promise<T | undefined> {
  return transaction([name], (tx) => request(tx.objectStore(name).get(id)));
}
export const put = (name: Store, value: unknown) =>
  transaction([name], async (tx) => {
    await request(tx.objectStore(name).put(value));
  });
export async function save(raw: unknown, id?: string) {
  const c = config(raw);
  return transaction(["monitors", "jobs"], async (tx) => {
    const ms = tx.objectStore("monitors"),
      js = tx.objectStore("jobs");
    const old = id ? await request<Monitor | undefined>(ms.get(id)) : undefined;
    if (id && !old) throw Error("MONITOR_DELETED");
    if (!old && (await request(ms.count())) >= 20) throw Error("MAX_MONITORS");
    const now = Date.now();
    const reset =
      !old ||
      [
        "url",
        "selector",
        "ignoreSelectors",
        "captureOptions",
        "readinessSelector",
        "failureSelector",
        "allowEmpty",
      ].some(
        (k) =>
          JSON.stringify((old as any)[k]) !== JSON.stringify((c as any)[k]),
      );
    const m: Monitor = old
      ? {
          ...old,
          ...c,
          configVersion: old.configVersion + (reset ? 1 : 0),
          baselineSnapshotId: reset ? undefined : old.baselineSnapshotId,
          health: reset ? "initializing" : old.health,
          nextDueAt: reset ? now : now + c.intervalMinutes * 60000,
          updatedAt: now,
        }
      : {
          ...c,
          id: crypto.randomUUID(),
          enabled: true,
          health: "initializing",
          configVersion: 1,
          nextDueAt: now,
          consecutiveFailures: 0,
          createdAt: now,
          updatedAt: now,
        };
    if (reset && old)
      for (const j of await request<Job[]>(js.getAll()))
        if (j.monitorId === old.id) {
          j.phase = "cancelled";
          await request(js.put(j));
        }
    await request(ms.put(m));
    return m;
  });
}
export async function acquire(session: string) {
  return transaction(["monitors", "jobs"], async (tx) => {
    const ms = tx.objectStore("monitors"),
      js = tx.objectStore("jobs");
    const monitors = await request<Monitor[]>(ms.getAll()),
      jobs = await request<Job[]>(js.getAll());
    const active = jobs.filter(
      (j) => !["finished", "failed", "cancelled"].includes(j.phase),
    );
    const origins = new Set(
      active.map((j) => monitors.find((m) => m.id === j.monitorId)?.origin),
    );
    const now = Date.now();
    const selected: Job[] = [];
    for (const m of monitors.sort((a, b) => a.nextDueAt - b.nextDueAt)) {
      if (active.length + selected.length >= 2) break;
      if (
        !m.enabled ||
        ["needs_permission", "needs_attention"].includes(m.health) ||
        m.nextDueAt > now ||
        active.some((j) => j.monitorId === m.id) ||
        origins.has(m.origin)
      )
        continue;
      const j: Job = {
        runId: crypto.randomUUID(),
        monitorId: m.id,
        configVersion: m.configVersion,
        phase: "queued",
        startedAt: now,
        deadlineAt: now + 60000,
        leaseUntil: now + 120000,
        attempt: m.consecutiveFailures + 1,
        session,
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
export async function mutate(id: string, action: string) {
  return transaction(
    ["monitors", "jobs", "snapshots", "changeEvents", "notificationOutbox"],
    async (tx) => {
      const ms = tx.objectStore("monitors"),
        js = tx.objectStore("jobs");
      const m = await request<Monitor | undefined>(ms.get(id));
      if (!m) throw Error("MONITOR_DELETED");
      const now = Date.now();
      if (
        action === "RUN_NOW" &&
        (await request<Job[]>(js.getAll())).some(
          (j) =>
            j.monitorId === id &&
            !["finished", "failed", "cancelled"].includes(j.phase),
        )
      )
        return;
      if (action !== "RUN_NOW") {
        m.configVersion++;
        for (const j of await request<Job[]>(js.getAll()))
          if (j.monitorId === id) {
            j.phase = "cancelled";
            await request(js.put(j));
          }
      }
      if (action === "DELETE_MONITOR") {
        await request(ms.delete(id));
        for (const name of ["snapshots", "changeEvents"] as const)
          for (const row of await request<any[]>(tx.objectStore(name).getAll()))
            if (row.monitorId === id) {
              if (name === "changeEvents")
                await request(
                  tx.objectStore("notificationOutbox").delete(row.id),
                );
              await request(tx.objectStore(name).delete(row.id));
            }
        for (const j of await request<Job[]>(js.getAll()))
          if (j.monitorId === id) await request(js.delete(j.runId));
        return;
      }
      if (action === "PAUSE_MONITOR") m.enabled = false;
      else {
        m.enabled = true;
        m.health = m.baselineSnapshotId ? "healthy" : "initializing";
        m.nextDueAt = now;
        m.lastError = undefined;
        m.consecutiveFailures = 0;
      }
      if (action === "RESET_BASELINE") {
        m.baselineSnapshotId = undefined;
        m.health = "initializing";
      }
      m.updatedAt = now;
      await request(ms.put(m));
    },
  );
}
export async function fail(runId: string, code: string) {
  await transaction(["jobs", "monitors"], async (tx) => {
    const js = tx.objectStore("jobs"),
      ms = tx.objectStore("monitors");
    const j = await request<Job | undefined>(js.get(runId));
    if (!j || ["finished", "failed", "cancelled"].includes(j.phase)) return;
    const m = await request<Monitor | undefined>(ms.get(j.monitorId));
    j.phase = ["TAB_CLOSED", "TAB_TAKEN_OVER"].includes(code)
      ? "cancelled"
      : "failed";
    j.error = code;
    await request(js.put(j));
    if (!m || m.configVersion !== j.configVersion || !m.enabled) return;
    const now = Date.now();
    if (j.phase === "cancelled") {
      m.nextDueAt = now + m.intervalMinutes * 60000;
    } else {
      m.consecutiveFailures++;
      const immediate = [
        "LOGIN_OR_ERROR_DETECTED",
        "REDIRECTED_ORIGIN",
        "SNAPSHOT_TOO_LARGE",
        "STORAGE_FULL",
      ];
      const three = [
        "SELECTOR_MISSING",
        "SELECTOR_AMBIGUOUS",
        "EMPTY_CONTENT",
        "UNSTABLE_CONTENT",
      ];
      m.health =
        code === "PERMISSION_REQUIRED"
          ? "needs_permission"
          : immediate.includes(code) ||
              (three.includes(code) && m.consecutiveFailures >= 3) ||
              m.consecutiveFailures >= 10
            ? "needs_attention"
            : "retrying";
      m.lastError = {
        code,
        userMessage: errorMessages[code] || code,
        occurredAt: now,
        diagnosticId: crypto.randomUUID(),
      };
      m.nextDueAt = now + backoff(m.intervalMinutes, m.consecutiveFailures);
    }
    await request(ms.put(m));
  });
}
async function cleanup(tx: IDBTransaction, now = Date.now()) {
  const ms = await request<Monitor[]>(tx.objectStore("monitors").getAll()),
    es = tx.objectStore("changeEvents"),
    ss = tx.objectStore("snapshots"),
    os = tx.objectStore("notificationOutbox");
  const events = await request<ChangeEvent[]>(es.getAll());
  const keep = new Set<string>();
  for (const m of ms) {
    const own = events
      .filter((e) => e.monitorId === m.id)
      .sort((a, b) => b.detectedAt - a.detectedAt);
    for (const e of own.filter(
      (e, i) => i < 50 && e.detectedAt >= now - 30 * 86400000,
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
  for (const s of await request<Snapshot[]>(ss.getAll()))
    if (!refs.has(s.id)) await request(ss.delete(s.id));
}
export async function prune() {
  await transaction(
    ["monitors", "snapshots", "changeEvents", "notificationOutbox", "jobs"],
    async (tx) => {
      await cleanup(tx);
      for (const j of await request<Job[]>(tx.objectStore("jobs").getAll()))
        if (
          ["finished", "failed", "cancelled"].includes(j.phase) &&
          j.startedAt < Date.now() - 86400000
        )
          await request(tx.objectStore("jobs").delete(j.runId));
    },
  );
}
export async function commit(
  runId: string,
  content: Content,
  finalUrl: string,
) {
  const hash = await digest(content);
  return transaction(
    ["monitors", "jobs", "snapshots", "changeEvents", "notificationOutbox"],
    async (tx) => {
      const js = tx.objectStore("jobs"),
        ms = tx.objectStore("monitors"),
        ss = tx.objectStore("snapshots");
      const j = await request<Job | undefined>(js.get(runId));
      if (!j || ["finished", "failed", "cancelled"].includes(j.phase)) return;
      const m = await request<Monitor | undefined>(ms.get(j.monitorId));
      const now = Date.now();
      if (
        !m ||
        !m.enabled ||
        j.configVersion !== m.configVersion ||
        now > j.leaseUntil ||
        now > j.deadlineAt
      )
        throw Error("CONFIG_CHANGED");
      if (new URL(finalUrl).origin !== m.origin)
        throw Error("REDIRECTED_ORIGIN");
      const old = m.baselineSnapshotId
        ? await request<Snapshot | undefined>(ss.get(m.baselineSnapshotId))
        : undefined;
      let event: ChangeEvent | undefined;
      if (!old || changed(old, content)) {
        await cleanup(tx);
        let snapshots = await request<Snapshot[]>(ss.getAll());
        let bytes = snapshots.reduce((n, s) => n + s.byteLength, 0);
        if (bytes + hash.byteLength > 50 * 1024 * 1024) {
          const es = tx.objectStore("changeEvents");
          for (const e of (await request<ChangeEvent[]>(es.getAll())).sort(
            (a, b) => a.detectedAt - b.detectedAt,
          )) {
            await request(es.delete(e.id));
            await request(tx.objectStore("notificationOutbox").delete(e.id));
            await cleanup(tx);
            snapshots = await request(ss.getAll());
            bytes = snapshots.reduce((n, s) => n + s.byteLength, 0);
            if (bytes + hash.byteLength <= 50 * 1024 * 1024) break;
          }
          if (bytes + hash.byteLength > 50 * 1024 * 1024)
            throw Error("STORAGE_FULL");
        }
        const s: Snapshot = {
          ...content,
          ...hash,
          id: crypto.randomUUID(),
          monitorId: m.id,
          runId,
          configVersion: m.configVersion,
          capturedAt: now,
          finalUrl,
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
            summary: "正規化內容已變更",
          };
          await request(tx.objectStore("changeEvents").add(event));
          const out: Outbox = {
            eventId: event.id,
            notificationId: "change:" + m.id + ":" + event.id,
            state: "pending",
            attempts: 0,
            updatedAt: now,
          };
          await request(tx.objectStore("notificationOutbox").add(out));
          m.lastChangeAt = now;
        }
        m.baselineSnapshotId = s.id;
      }
      m.lastSuccessAt = now;
      m.nextDueAt = now + m.intervalMinutes * 60000;
      m.health = "healthy";
      m.consecutiveFailures = 0;
      m.lastError = undefined;
      m.errorNotifiedCode = undefined;
      await request(ms.put(m));
      j.phase = "finished";
      await request(js.put(j));
      await cleanup(tx);
      return event;
    },
  );
}
export async function clear() {
  await transaction([...stores], async (tx) => {
    for (const s of stores) await request(tx.objectStore(s).clear());
    await request(
      tx.objectStore("settings").put({
        key: "global",
        schemaVersion: 1,
        notificationsEnabled: true,
        retentionDays: 30,
        maxEventsPerMonitor: 50,
        uiPreferences: {},
      }),
    );
  });
}
export async function claimNotification(eventId: string) {
  return transaction(["notificationOutbox"], async (tx) => {
    const s = tx.objectStore("notificationOutbox"),
      row = await request<Outbox | undefined>(s.get(eventId));
    if (
      !row ||
      row.state === "sent" ||
      row.attempts >= 3 ||
      (row.lastError === "IN_FLIGHT" && Date.now() - row.updatedAt < 60000)
    )
      return;
    row.attempts++;
    row.updatedAt = Date.now();
    row.lastError = "IN_FLIGHT";
    await request(s.put(row));
    return row;
  });
}
