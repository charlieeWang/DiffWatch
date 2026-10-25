import { chromium } from "playwright";
import http from "node:http";
import { cp, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const root = process.cwd();
await mkdir("work", { recursive: true });
const extension = path.join(root, "work/picker-flow-extension");
await cp("dist", extension, { recursive: true });
const manifest = JSON.parse(
  await readFile(path.join(extension, "manifest.json"), "utf8"),
);
manifest.host_permissions = ["http://127.0.0.1/*", "http://localhost/*"];
await writeFile(
  path.join(extension, "manifest.json"),
  JSON.stringify(manifest),
);
const server = http.createServer((req, res) =>
  setTimeout(() => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "http://localhost:8766/" });
      res.end();
    } else {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><meta charset="utf-8"><main id="region" style="padding:24px;border:2px solid teal;max-width:600px"><h1>測試商品</h1><p id="price">價格 100</p><span id="clock">倒數 10</span><span id="ad">廣告</span></main>',
      );
    }
  }, 500),
);
await new Promise((r) => server.listen(8766, "127.0.0.1", r));
let ctx;
try {
  ctx = await chromium.launchPersistentContext(
    "work/picker-flow-" + Date.now(),
    {
      executablePath:
        process.env.CHROME_EXECUTABLE || chromium.executablePath(),
      headless: true,
      args: [
        "--disable-extensions-except=" + extension,
        "--load-extension=" + extension,
      ],
    },
  );
  const w =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker"));
  const id = new URL(w.url()).host;
  const p = await ctx.newPage();
  await p.goto("chrome-extension://" + id + "/dashboard.html");
  await p.getByRole("button", { name: "新增任務" }).click();
  await p.locator("input[name=url]").fill("http://127.0.0.1:8766/");
  const launch = p.getByRole("button", { name: "開啟網頁並選取區域" });
  assert.equal(await p.locator(".selection-tools button").count(), 1);
  const opened = ctx.waitForEvent("page");
  await launch.click();
  const site = await opened;
  const next = site.getByRole("button", { name: "下一步：設定監控" });
  const select = site.getByRole("button", {
    name: "選取監控區域",
    exact: true,
  });
  const ignore = site.getByRole("button", { name: "忽略區塊", exact: true });
  await select.waitFor();
  assert(await ignore.isDisabled());
  assert(await next.isDisabled());
  assert.equal(
    await site.getByRole("textbox", { name: "CSS selector" }).isVisible(),
    false,
  );
  await site.locator("#region").click({ position: { x: 5, y: 5 } });
  assert(await next.isEnabled());
  const preview = site.locator("[data-dom-watch-overlay]").locator(".preview");
  assert((await preview.innerText()).includes("倒數 10"));
  await ignore.click();
  await site.locator("#clock").click();
  await site.locator("#ad").click();
  assert.equal(await ignore.getAttribute("aria-pressed"), "true");
  assert.equal(
    await site
      .locator("[data-dom-watch-overlay]")
      .locator(".ignored li")
      .count(),
    2,
  );
  assert(!(await preview.innerText()).includes("倒數 10"));
  await site
    .getByRole("button", { name: "恢復忽略區塊 1", exact: true })
    .click();
  assert((await preview.innerText()).includes("倒數 10"));
  await site.getByText("進階設定", { exact: true }).click();
  await site.getByRole("textbox", { name: "CSS selector" }).fill("#missing");
  assert(await next.isDisabled());
  assert(await ignore.isDisabled());
  assert((await preview.innerText()).includes("無法預覽"));
  await site.getByRole("textbox", { name: "CSS selector" }).fill("#region");
  assert(await next.isEnabled());
  await site.getByText("進階設定", { exact: true }).click();
  await site.screenshot({
    path: "work/picker-simple-desktop.png",
    fullPage: true,
  });
  await site.setViewportSize({ width: 390, height: 844 });
  assert(
    await site
      .locator("[data-dom-watch-overlay]")
      .locator("aside")
      .evaluate((n) => n.getBoundingClientRect().right <= innerWidth),
  );
  await site.screenshot({
    path: "work/picker-simple-mobile.png",
    fullPage: true,
  });
  console.log(
    "PASS: two modes, multiple ignored blocks, undo, preview, invalidation, advanced settings and mobile layout",
  );
  assert.equal(await site.evaluate(() => document.readyState), "complete");
  await p.waitForFunction(
    () => !document.querySelector(".selection-tools button").disabled,
  );
  await site.keyboard.press("Escape");
  await site.close();
  console.log(
    "PASS: one click opens page, waits for load and injects picker without second action",
  );
  await p.locator("input[name=url]").fill("http://127.0.0.1:8766/redirect");
  const redirect = ctx.waitForEvent("page");
  await launch.click();
  const redirected = await redirect;
  await p
    .getByRole("status")
    .filter({ hasText: "REDIRECTED_ORIGIN" })
    .waitFor();
  assert.equal(await redirected.locator("[data-dom-watch-overlay]").count(), 0);
  await p.waitForFunction(
    () => !document.querySelector(".selection-tools button").disabled,
  );
  console.log(
    "PASS: cross-origin redirect is rejected and launch button recovers",
  );
} finally {
  if (ctx) await ctx.close();
  await new Promise((r) => server.close(r));
}
