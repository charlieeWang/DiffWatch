import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Exercise the built UI with deterministic stored data, without background tab jobs.
const browser = await chromium.launch({
  executablePath: process.env.CHROME_EXECUTABLE,
});
try {
  const page = await browser.newPage();
  await page.route("http://diffwatch.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      contentType: path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
      body: await readFile(
        `dist/${path === "/" ? "dashboard.html" : path.slice(1)}`,
      ),
    });
  });
  await page.addInitScript(() => {
    const monitor = {
      id: "test",
      name: "預覽測試",
      url: "https://example.com/",
      origin: "https://example.com",
      selector: "#products",
      ignoreSelectors: [],
      captureOptions: { text: true, links: true, images: true },
      intervalMinutes: 5,
      settleDelayMs: 2000,
      allowEmpty: false,
      notifications: true,
      enabled: false,
      health: "healthy",
      configVersion: 1,
      baselineSnapshotId: "sample",
      consecutiveFailures: 0,
    };
    const snapshot = {
      id: "sample",
      capturedAt: Date.now(),
      captureOptions: { text: true, links: true, images: false },
      textBlocks: ["商品 <script>測試</script>"],
      links: [{ text: "商品頁", href: "https://example.com/item" }],
      images: [],
    };
    window.chrome = {
      permissions: {
        contains: async ({ origins }) => origins[0] === "https://example.com/*",
      },
      runtime: {
        sendMessage: async () => ({
          ok: true,
          value: {
            monitors: [monitor],
            snapshots: [snapshot],
            events: [],
            jobs: [],
            outbox: [],
            diagnostics: [],
            settings: {},
          },
        }),
      },
    };
  });
  await page.goto("http://diffwatch.test/");
  await page.getByRole("button", { name: "編輯", exact: true }).click();
  assert.equal(await page.locator("p.error").count(), 0);
  await page
    .getByRole("button", { name: "重新擷取快照", exact: true })
    .waitFor();
  const panel = page.locator(".capture-preview");
  assert.match(await panel.textContent(), /目前儲存的快照/);
  assert.match(
    await panel.locator('[data-capture="text"] pre').textContent(),
    /<script>測試<\/script>/,
  );
  assert.equal(await panel.locator("script").count(), 0);
  assert.match(
    await panel.locator('[data-capture="images"]').textContent(),
    /未擷取此類內容/,
  );
  await page.locator('input[name="text"]').uncheck();
  assert.equal(await panel.locator('[data-capture="text"]').count(), 0);
  await page.locator('input[name="text"]').check();
  assert(await panel.locator('[data-capture="text"] pre').isVisible());
  await page.locator('input[name="url"]').fill("https://example.com/changed");
  assert.match(await panel.textContent(), /以下仍是原範圍的內容/);
  await page.locator('input[name="url"]').fill("https://other.example/");
  await page
    .getByRole("button", { name: "授權並擷取快照", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("checkbox", { name: "桌面通知", exact: true })
      .isVisible(),
  );
  assert.match(
    await page.locator("#help-allowEmpty").textContent(),
    /保留原基準/,
  );
  await page.screenshot({
    path: "work/form-snapshot-preview.png",
    fullPage: true,
  });
  console.log(
    "Stored snapshot, checkbox preview, missing categories, stale range and safe text rendering PASS",
  );
} finally {
  await browser.close();
}
