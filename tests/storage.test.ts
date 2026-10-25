import "fake-indexeddb/auto";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as db from "../src/storage";
import {
  config,
  type Content,
  type Monitor,
  type Job,
  type ChangeEvent,
} from "../src/core";
const c = config({
  name: "test",
  url: "https://example.com/",
  selector: "#root",
  ignoreSelectors: [],
  captureOptions: { text: true, links: true, images: true },
  allowEmpty: false,
  intervalMinutes: 1,
  settleDelayMs: 0,
});
const content = (text: string): Content => ({
  normalizationVersion: 1,
  captureOptions: c.captureOptions,
  textBlocks: [text],
  links: [],
  images: [],
});
async function due(id: string) {
  await db.transaction(["monitors"], async (tx) => {
    const s = tx.objectStore("monitors");
    const m = await db.request<Monitor>(s.get(id));
    m.nextDueAt = 0;
    await db.request(s.put(m));
  });
  return (await db.acquire("session"))[0];
}
test("atomic baseline/event/outbox, duplicate completion, ABA and lease/version cancellation", async () => {
  await db.clear();
  const m = await db.save(c);
  const j = (await db.acquire("session"))[0];
  await db.commit(j.runId, content("A"), c.url);
  assert.equal((await db.all("changeEvents")).length, 0);
  const j2 = await due(m.id);
  await db.commit(j2.runId, content("B"), c.url);
  await db.commit(j2.runId, content("B"), c.url);
  assert.equal((await db.all("changeEvents")).length, 1);
  assert.equal((await db.all("notificationOutbox")).length, 1);
  const j3 = await due(m.id);
  await db.commit(j3.runId, content("B"), c.url);
  assert.equal((await db.all("snapshots")).length, 2);
  const j4 = await due(m.id);
  await db.commit(j4.runId, content("A"), c.url);
  assert.equal((await db.all("changeEvents")).length, 2);
  const j5 = await due(m.id);
  await db.mutate(m.id, "PAUSE_MONITOR");
  await db.commit(j5.runId, content("C"), c.url);
  assert.equal((await db.all("changeEvents")).length, 2);
});
test("transaction abort preserves baseline and rolls back inserts", async () => {
  const old = await db.all("monitors");
  await assert.rejects(
    db.transaction(["monitors"], async (tx) => {
      await db.request(tx.objectStore("monitors").clear());
      throw Error("forced quota/transaction failure");
    }),
  );
  assert.deepEqual(await db.all("monitors"), old);
});
test("atomic global 2 and origin 1 leases; deletion prevents late resurrection", async () => {
  await db.clear();
  const a = await db.save(c);
  await db.save({ ...c, name: "second" });
  await db.save({ ...c, url: "https://other.example/" });
  const runs = (await Promise.all([db.acquire("s"), db.acquire("s")])).flat();
  assert.equal(runs.length, 2);
  assert.equal(new Set(runs.map((r) => r.monitorId)).size, 2);
  await db.mutate(a.id, "DELETE_MONITOR");
  for (const r of runs)
    await db.commit(r.runId, content("late"), c.url).catch(() => {});
  assert.equal(await db.get("monitors", a.id), undefined);
});
test("expired lease refuses commit; cleanup retains baseline", async () => {
  await db.clear();
  const m = await db.save(c);
  const j = (await db.acquire("s"))[0];
  await db.put("jobs", { ...j, leaseUntil: 0 });
  await assert.rejects(db.commit(j.runId, content("A"), c.url));
  assert.equal(
    (await db.get<Monitor>("monitors", m.id))?.baselineSnapshotId,
    undefined,
  );
  await db.fail(j.runId, "WORKER_INTERRUPTED");
  const retry = await due(m.id);
  await db.commit(retry.runId, content("A"), c.url);
  await db.prune();
  assert.equal((await db.all("snapshots")).length, 1);
});
test("20 tasks accepted, 21 rejected, clear all and schema version", async () => {
  await db.clear();
  for (let i = 0; i < 20; i++) await db.save(c);
  await assert.rejects(db.save(c), /MAX_MONITORS/);
  await db.clear();
  for (const s of [
    "monitors",
    "jobs",
    "snapshots",
    "changeEvents",
    "notificationOutbox",
  ] as const)
    assert.equal((await db.all(s)).length, 0);
  assert.equal((await db.get<any>("settings", "global")).schemaVersion, 1);
});
test("outbox claims are atomic and bounded independently of jobs", async () => {
  await db.clear();
  const row = {
    eventId: crypto.randomUUID(),
    notificationId: "fixed",
    state: "pending",
    attempts: 0,
    updatedAt: Date.now(),
  };
  await db.put("notificationOutbox", row);
  const claims = await Promise.all([
    db.claimNotification(row.eventId),
    db.claimNotification(row.eventId),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  for (let i = 0; i < 2; i++) {
    const saved = await db.get<any>("notificationOutbox", row.eventId);
    await db.put("notificationOutbox", {
      ...saved,
      state: "failed",
      lastError: "NOTIFICATION_FAILED",
    });
    assert(await db.claimNotification(row.eventId));
  }
  const saved = await db.get<any>("notificationOutbox", row.eventId);
  await db.put("notificationOutbox", {
    ...saved,
    lastError: "NOTIFICATION_FAILED",
  });
  assert.equal(await db.claimNotification(row.eventId), undefined);
});
test("retention removes oldest events while retaining baseline and referenced snapshots", async () => {
  await db.clear();
  const m = await db.save(c);
  let j = (await db.acquire("s"))[0];
  await db.commit(j.runId, content("0"), c.url);
  for (let i = 1; i <= 55; i++) {
    j = await due(m.id);
    await db.commit(j.runId, content(String(i)), c.url);
  }
  assert.equal((await db.all("changeEvents")).length, 50);
  for (const e of await db.all<ChangeEvent>("changeEvents"))
    await db.put("changeEvents", { ...e, detectedAt: 0 });
  await db.prune();
  assert.equal((await db.all("changeEvents")).length, 0);
  assert.equal((await db.all("notificationOutbox")).length, 0);
  const monitor = await db.get<Monitor>("monitors", m.id);
  const snapshot = await db.get<any>("snapshots", monitor!.baselineSnapshotId!);
  assert.deepEqual(snapshot.textBlocks, ["55"]);
  assert.equal((await db.all("snapshots")).length, 1);
});
