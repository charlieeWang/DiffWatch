import { chromium } from "playwright";
import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
await mkdir("work", { recursive: true });
const extension = path.resolve("work/offline-extension");
await cp("dist", extension, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["http://127.0.0.1/*"];
await writeFile(
  path.join(extension, "manifest.json"),
  JSON.stringify(manifest),
);
const ctx = await chromium.launchPersistentContext(
  "work/offline-profile-" + Date.now(),
  {
    executablePath: process.env.CHROME_EXECUTABLE || chromium.executablePath(),
    headless: true,
    args: [
      "--disable-extensions-except=" + extension,
      "--load-extension=" + extension,
    ],
  },
);
let blocked = true;
await ctx.route("http://127.0.0.1:8770/**", (route) =>
  blocked
    ? route.abort("internetdisconnected")
    : route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><main id="region">Stable content</main>',
      }),
);
try {
  const worker =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const page = await ctx.newPage();
  await page.goto("chrome-extension://" + id + "/dashboard.html");
  const send = async (m) => {
    const r = await page.evaluate((m) => chrome.runtime.sendMessage(m), m);
    if (!r.ok) throw Error(r.error);
    return r.value;
  };
  await send({ type: "CLEAR_ALL" });
  const config = {
    name: "Offline regression",
    url: "http://127.0.0.1:8770/",
    selector: "#region",
    ignoreSelectors: [],
    captureOptions: { text: true, links: true, images: true },
    allowEmpty: false,
    intervalMinutes: 1,
    settleDelayMs: 0,
    notifications: false,
  };
  async function until(fn) {
    const started = Date.now();
    while (Date.now() - started < 20000) {
      const s = await send({ type: "STATE" });
      if (fn(s)) return s;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(
      "condition timed out " + JSON.stringify(await send({ type: "STATE" })),
    );
  }
  const monitor = await send({ type: "CREATE_MONITOR", config });
  let state = await until(
    (s) =>
      s.jobs.length &&
      s.jobs.every((j) => j.phase === "failed" && j.tabId === undefined),
  );
  assert.equal(state.monitors[0].lastError.code, "LOAD_TIMEOUT");
  assert.equal(state.monitors[0].consecutiveFailures, 1);
  assert.equal(ctx.pages().length, 2); // original blank and management page only
  for (let i = 0; i < 5; i++) {
    const count = state.jobs.length;
    await send({ type: "RUN_NOW", id: monitor.id });
    state = await until(
      (s) =>
        s.jobs.length > count &&
        s.jobs.every((j) => j.phase === "failed" && j.tabId === undefined),
    );
    assert.equal(ctx.pages().length, 2);
  }
  assert.equal(state.snapshots.length, 0);
  assert.equal(state.events.length, 0);
  assert(state.diagnostics.some((e) => e.code === "LOAD_TIMEOUT"));
  console.log(
    "PASS: repeated network failures close non-injectable error tabs, preserve baseline and record failures",
  );
  await worker.evaluate(() => {
    globalThis.__originalRemove = chrome.tabs.remove;
    chrome.tabs.remove = () =>
      Promise.reject(Error("simulated removal failure"));
  });
  await send({ type: "RUN_NOW", id: monitor.id });
  state = await until((s) =>
    s.jobs.some(
      (j) => j.phase === "failed" && j.ownsTab && j.tabId !== undefined,
    ),
  );
  await until((s) =>
    s.diagnostics.some((e) => e.code === "TAB_CLEANUP_FAILED"),
  );
  const count = state.jobs.length;
  for (let i = 0; i < 3; i++) await send({ type: "RUN_NOW", id: monitor.id });
  await new Promise((r) => setTimeout(r, 400));
  state = await send({ type: "STATE" });
  assert.equal(state.jobs.length, count);
  assert.equal(ctx.pages().length, 3);
  console.log("PASS: unresolved owned tab blocks further launches");
  await worker.evaluate(() => {
    chrome.tabs.remove = globalThis.__originalRemove;
  });
  blocked = false;
  await send({ type: "RUN_NOW", id: monitor.id });
  state = await until(
    (s) =>
      s.monitors[0].health === "healthy" &&
      s.jobs.every((j) => j.tabId === undefined),
  );
  assert.equal(state.snapshots.length, 1);
  assert.equal(state.events.length, 0);
  assert.equal(ctx.pages().length, 2);
  console.log(
    "PASS: reconnect cleans pending tabs and creates baseline without false change",
  );
  await page.reload();
  await page.getByRole("button", { name: "錯誤紀錄", exact: true }).click();
  await page.getByRole("button", { name: "匯出紀錄" }).waitFor();
  assert(
    (await page.getByRole("heading", { name: /LOAD_TIMEOUT/ }).count()) > 0,
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "清除紀錄", exact: true }).click();
  await page.getByText("目前沒有錯誤紀錄。", { exact: true }).waitFor();
  state = await send({ type: "STATE" });
  assert.equal(state.diagnostics.length, 0);
  assert.equal(state.snapshots.length, 1);
  console.log("PASS: diagnostics page and clearing do not erase task baseline");
  console.log("OFFLINE REGRESSION PASS");
} finally {
  await ctx.close();
}
