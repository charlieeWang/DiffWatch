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
      res.end('<!doctype html><h1 id="region">Picker flow test</h1>');
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
  await site.getByRole("textbox", { name: "CSS selector" }).waitFor();
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
