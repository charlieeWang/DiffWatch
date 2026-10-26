import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { cp, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const root = process.cwd().replaceAll("\\", "/");
await mkdir(root + "/work", { recursive: true });
await cp(root + "/dist", root + "/work/test-extension", { recursive: true });
const manifest = JSON.parse(
  await readFile(root + "/work/test-extension/manifest.json", "utf8"),
);
manifest.host_permissions = ["http://127.0.0.1/*", "http://localhost/*"];
await writeFile(
  root + "/work/test-extension/manifest.json",
  JSON.stringify(manifest),
);
const fixture = spawn(process.execPath, ["fixtures/server.mjs"], {
  stdio: "pipe",
  windowsHide: true,
});
await new Promise((resolve, reject) => {
  fixture.stdout.once("data", resolve);
  fixture.once("error", reject);
  fixture.once("exit", (code) => {
    if (code) reject(Error("Fixture failed: " + code));
  });
});
const ctx = await chromium.launchPersistentContext(
  root + "/work/cft-profile-" + Date.now(),
  {
    executablePath: process.env.CHROME_EXECUTABLE || chromium.executablePath(),
    headless: true,
    args: [
      "--disable-extensions-except=" + root + "/work/test-extension",
      "--load-extension=" + root + "/work/test-extension",
    ],
  },
);
try {
  const worker =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  console.log("Extension", id, "Browser", ctx.browser()?.version());
  const page = await ctx.newPage();
  await page.goto("chrome-extension://" + id + "/dashboard.html");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const send = async (m) => {
    const r = await page.evaluate((m) => chrome.runtime.sendMessage(m), m);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  await send({ type: "CLEAR_ALL" });
  await fetch("http://127.0.0.1:8765/set?v=A");
  const config = {
    name: "E2E test",
    url: "http://127.0.0.1:8765/",
    selector: "#products",
    ignoreSelectors: [".countdown"],
    captureOptions: { text: true, links: true, images: true },
    allowEmpty: false,
    intervalMinutes: 1,
    settleDelayMs: 0,
    notifications: true,
  };
  const m = await send({ type: "CREATE_MONITOR", config });
  console.log("Created", m.id);
  async function until(fn, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const s = await send({ type: "STATE" });
      if (fn(s)) return s;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw Error("TIMEOUT " + JSON.stringify(await send({ type: "STATE" })));
  }
  let s = await until((s) => s.monitors[0]?.health === "healthy");
  assert.equal(s.events.length, 0);
  assert.equal(s.snapshots.length, 1);
  console.log("AC01 baseline pass");
  await fetch("http://127.0.0.1:8765/set?v=B");
  await send({ type: "RUN_NOW", id: m.id });
  s = await until((s) => s.events.length === 1);
  assert.equal(s.snapshots.length, 2);
  console.log("AC03 A-B pass");
  await send({ type: "RUN_NOW", id: m.id });
  const stamp = s.monitors[0].lastSuccessAt;
  s = await until((s) => s.monitors[0].lastSuccessAt > stamp);
  assert.equal(s.events.length, 1);
  console.log("AC03 B-B no duplicate pass");
  await fetch("http://127.0.0.1:8765/set?v=A");
  await send({ type: "RUN_NOW", id: m.id });
  s = await until((s) => s.events.length === 2);
  console.log("AC04 B-A pass");
  await page.getByRole("button", { name: "歷史", exact: true }).click();
  await page.screenshot({
    path: root + "/work/history-preview.png",
    fullPage: true,
  });
  assert((await page.getByText("舊內容", { exact: true }).count()) > 0);
  assert.equal(errors.length, 0);
  console.log("History UI safe rendering pass");
  await send({ type: "PAUSE_MONITOR", id: m.id });
  await send({ type: "DELETE_MONITOR", id: m.id });
  s = await send({ type: "STATE" });
  assert.equal(s.monitors.length, 0);
  assert.equal(s.events.length, 0);
  assert.equal(s.snapshots.length, 0);
  console.log("Delete cascade pass");
  const redirect = await send({
    type: "CREATE_MONITOR",
    config: { ...config, url: "http://127.0.0.1:8765/redirect" },
  });
  s = await until((s) => s.monitors[0]?.health === "needs_attention");
  assert.equal(s.monitors[0].lastError.code, "REDIRECTED_ORIGIN");
  assert.equal(s.snapshots.length, 0);
  console.log("AC10 cross origin redirect pass");
  await send({ type: "CLEAR_ALL" });
  const owned = await send({
    type: "CREATE_MONITOR",
    config: { ...config, settleDelayMs: 10000 },
  });
  let live = await until((s) =>
    s.jobs.some((j) => j.monitorId === owned.id && j.phase === "sampling"),
  );
  const taken = live.jobs.find(
    (j) => j.monitorId === owned.id && j.phase === "sampling",
  );
  await worker.evaluate(
    (id) => chrome.tabs.update(id, { active: true }),
    taken.tabId,
  );
  live = await until((s) =>
    s.jobs.some((j) => j.runId === taken.runId && j.phase === "cancelled"),
  );
  assert.equal(
    live.jobs.find((j) => j.runId === taken.runId).error,
    "TAB_TAKEN_OVER",
  );
  await page.bringToFront();
  await send({ type: "PAUSE_MONITOR", id: owned.id });
  assert(
    await worker.evaluate(
      (id) =>
        chrome.tabs.get(id).then(
          () => true,
          () => false,
        ),
      taken.tabId,
    ),
  );
  console.log("AC16 takeover tab preserved pass");
  await send({ type: "CLEAR_ALL" });
  const recover = await send({
    type: "CREATE_MONITOR",
    config: { ...config, settleDelayMs: 4000 },
  });
  await until((s) =>
    s.jobs.some((j) => j.monitorId === recover.id && j.phase === "sampling"),
  );
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  live = await until(
    (s) => s.monitors.find((m) => m.id === recover.id)?.health === "healthy",
  );
  assert.equal(live.events.length, 0);
  assert.equal(live.snapshots.length, 1);
  console.log("AC12 sampling survives stopped worker pass");
  if (process.env.SCHEDULE_TEST === "1") {
    const initial = live.monitors[0].lastSuccessAt;
    const active = await page.evaluate(() =>
      chrome.tabs
        .query({ active: true, currentWindow: true })
        .then((t) => t[0].id),
    );
    live = await until((s) => s.monitors[0].lastSuccessAt > initial, 140000);
    const once = live.monitors[0].lastSuccessAt;
    live = await until((s) => s.monitors[0].lastSuccessAt > once, 140000);
    assert.equal(
      await page.evaluate(() =>
        chrome.tabs
          .query({ active: true, currentWindow: true })
          .then((t) => t[0].id),
      ),
      active,
    );
    assert.equal(live.events.length, 0);
    console.log(
      "AC02/20 formal one-minute interval two rounds active-tab unchanged pass",
    );
  }
  await send({ type: "CLEAR_ALL" });
  const site = await ctx.newPage();
  await site.goto("http://127.0.0.1:8765/?picker=1");
  const tabId = await page.evaluate(() =>
    chrome.tabs
      .query({ url: "http://127.0.0.1:8765/?picker=1" })
      .then((t) => t[0].id),
  );
  await send({ type: "START_PICKER", tabId });
  await site.getByText("進階設定", { exact: true }).click();
  await site.getByRole("textbox", { name: "CSS selector" }).fill("#products");
  await site.getByRole("button", { name: "忽略區塊", exact: true }).click();
  await site.locator(".countdown").click();
  const nextPage = ctx.waitForEvent("page");
  await site.getByRole("button", { name: "下一步：設定監控" }).click();
  const editor = await nextPage;
  await editor.waitForLoadState();
  await editor.locator("input[name=name]").fill("視覺選取測試");
  assert.equal(
    await editor.locator(".form-advanced").getAttribute("open"),
    null,
  );
  assert.equal(await editor.locator("input[name=selector]").isVisible(), false);
  assert(
    await editor
      .getByRole("button", { name: "開啟網頁並選取區域" })
      .isVisible(),
  );
  await editor.screenshot({
    path: "work/form-simple-collapsed.png",
    fullPage: true,
  });
  const saveButton = editor.getByRole("button", {
    name: "授權並儲存",
    exact: true,
  });
  assert(
    await saveButton.isDisabled(),
    "new task requires preview before saving",
  );
  assert.equal(await editor.locator(".selection-tools button").count(), 1);
  assert(
    await editor.getByRole("button", { name: "返回任務列表" }).isVisible(),
  );
  await editor.locator("form").evaluate((form) => form.requestSubmit());
  assert(await saveButton.isDisabled(), "Enter cannot bypass the preview gate");
  await editor.getByRole("button", { name: "授權並驗證預覽" }).click();
  await editor.locator("form pre").filter({ hasText: "驗證成功" }).waitFor();
  editor.on("dialog", (d) => d.accept());
  assert(await saveButton.isEnabled(), "successful preview enables save");
  await editor.locator(".form-advanced summary").click();
  assert(await editor.locator("input[name=selector]").isVisible());
  await editor.locator("input[name=selector]").fill("#products h2");
  assert(await saveButton.isDisabled(), "changed settings invalidate preview");
  await editor.locator("input[name=selector]").fill("#products");
  assert(await saveButton.isEnabled());
  await editor.screenshot({
    path: "work/form-preview-gate.png",
    fullPage: true,
  });
  await editor.getByRole("button", { name: "授權並儲存", exact: true }).click();
  live = await until((s) =>
    s.monitors.some((m) => m.name === "視覺選取測試" && m.health === "healthy"),
  );
  assert.equal(live.monitors[0].ignoreSelectors.length, 1);
  await editor.getByRole("button", { name: "編輯", exact: true }).click();
  const capturePanel = editor.locator(".capture-preview");
  await capturePanel.getByText(/目前儲存的快照/).waitFor();
  assert(await capturePanel.locator('[data-capture="text"] pre').isVisible());
  await editor.locator('input[name="text"]').uncheck();
  assert.equal(await capturePanel.locator('[data-capture="text"]').count(), 0);
  assert(await capturePanel.locator('[data-capture="links"]').isVisible());
  await editor.locator('input[name="text"]').check();
  assert(await capturePanel.locator('[data-capture="text"] pre').isVisible());
  await editor
    .locator('input[name="url"]')
    .fill("http://127.0.0.1:8765/?changed=1");
  await capturePanel.getByText(/以下仍是原範圍的內容/).waitFor();
  await editor.screenshot({
    path: "work/form-snapshot-preview.png",
    fullPage: true,
  });
  assert(
    await editor
      .getByRole("checkbox", { name: "桌面通知", exact: true })
      .isVisible(),
  );
  console.log("Picker ignore preview save baseline UI pass");
  const bench = await ctx.newPage();
  await bench.goto("http://127.0.0.1:8765/?mode=benchmark");
  const bid = await page.evaluate(() =>
    chrome.tabs
      .query({ url: "http://127.0.0.1:8765/?mode=benchmark" })
      .then((t) => t[0].id),
  );
  const result = await send({
    type: "PREVIEW_SELECTION",
    tabId: bid,
    config: {
      ...config,
      url: "http://127.0.0.1:8765/?mode=benchmark",
      ignoreSelectors: [],
    },
  });
  assert(result.ok);
  assert.equal(result.content.textBlocks.length, 2500);
  assert(result.byteLength < 262144);
  console.log(
    "Chrome 5000-node capture",
    result.durationMs.toFixed(1) + "ms",
    result.byteLength + " bytes",
  );
  console.log("E2E PASS");
} finally {
  await ctx.close();
  fixture.kill();
}
