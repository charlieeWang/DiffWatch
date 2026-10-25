import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  extract,
  canonical,
  changed,
  backoff,
  diff,
  config,
  digest,
} from "../src/core";
export const cfg = config({
  name: "測試",
  url: "http://127.0.0.1:8765/#foo",
  selector: "#root",
  ignoreSelectors: [],
  captureOptions: { text: true, links: true, images: true },
  allowEmpty: false,
  intervalMinutes: 1,
  settleDelayMs: 0,
});
const document = (html: string) =>
  new JSDOM(html, { url: cfg.url }).window.document;
test("URL validation, fragment removal, import constraints", () => {
  assert.equal(cfg.url, "http://127.0.0.1:8765/");
  for (const url of [
    "file:///x",
    "https://user:password@example.com",
    "https://chromewebstore.google.com/detail/x",
  ])
    assert.throws(() => config({ ...cfg, url }));
  assert.throws(() => config({ ...cfg, intervalMinutes: 0 }));
  assert.throws(() =>
    config({
      ...cfg,
      captureOptions: { text: false, links: false, images: false },
    }),
  );
});
test("fixed block normalization, NFC, hidden and input exclusions", () => {
  const c = extract(
    document(
      '<main id="root"><p>  cafe\u0301\r\n X </p><div>line <b> two</b></div><span hidden>hidden</span><span style="display:none">secret</span><input value="password"><textarea>private</textarea><script>bad()</script><p aria-hidden="true">no</p></main>',
    ),
    cfg,
  );
  assert.deepEqual(c.textBlocks, ["café X", "line two"]);
});
test("ordered duplicates, absolute URLs, image alt and relative ignored children", () => {
  const c = extract(
    document(
      '<main id="root"><a href="/a?q=1#x"> A </a><a href="/a?q=1#x"> A </a><img src="i.png" alt=" hi "><span class="clock">10</span></main>',
    ),
    { ...cfg, ignoreSelectors: [".clock"] },
  );
  assert.equal(c.links.length, 2);
  assert.equal(c.links[0].href, "http://127.0.0.1:8765/a?q=1#x");
  assert.equal(c.images[0].src, "http://127.0.0.1:8765/i.png");
  assert.equal(c.images[0].alt, "hi");
  assert(!c.textBlocks.join("").includes("10"));
});
test("strict root cardinality and empty handling", () => {
  assert.throws(
    () => extract(document("<div></div>"), cfg),
    /SELECTOR_MISSING/,
  );
  assert.throws(
    () => extract(document('<p id="root"></p><p id="root"></p>'), cfg),
    /SELECTOR_AMBIGUOUS/,
  );
  assert.throws(
    () => extract(document('<div id="root"></div>'), cfg),
    /EMPTY_CONTENT/,
  );
  assert.equal(
    extract(document('<div id="root"></div>'), { ...cfg, allowEmpty: true })
      .textBlocks.length,
    0,
  );
});
test("A B B A adjacent comparisons; disabled channels and stable canonical hash", async () => {
  const a = extract(document('<p id="root">A</p>'), cfg),
    b = { ...a, textBlocks: ["B"] };
  assert(changed(a, b));
  assert(!changed(b, b));
  assert(changed(b, a));
  assert.equal((await digest(a)).hash, (await digest({ ...a })).hash);
  assert.equal(
    canonical({
      ...a,
      captureOptions: { text: true, links: false, images: false },
      links: [{ href: "evil", text: "x" }],
    }),
    canonical({
      ...a,
      captureOptions: { text: true, links: false, images: false },
    }),
  );
});
test("ordered diff and capped backoff", () => {
  assert.deepEqual(
    diff(["a", "b"], ["b", "a"]).map((d) => d.kind),
    ["removed", "same", "added"],
  );
  assert.equal(backoff(5, 1), 300000);
  assert.equal(backoff(1, 20), 3600000);
});
test("node and byte limits never truncate", () => {
  assert.throws(
    () =>
      extract(
        document('<main id="root">' + "<i>x</i>".repeat(11000) + "</main>"),
        cfg,
      ),
    /SNAPSHOT_TOO_LARGE/,
  );
  assert.throws(
    () =>
      extract(
        document('<main id="root">' + "界".repeat(90000) + "</main>"),
        cfg,
      ),
    /SNAPSHOT_TOO_LARGE/,
  );
});
test("5000-node capture benchmark", async () => {
  const d = document(
    '<main id="root">' + "<p>商品 100 元</p>".repeat(2499) + "尾" + "</main>",
  );
  const start = performance.now();
  const result = extract(d, cfg);
  const hashed = await digest(result);
  diff(result.textBlocks, [...result.textBlocks, "新增"]);
  console.log(
    `5000 nodes: ${(performance.now() - start).toFixed(1)}ms, ${hashed.byteLength} bytes`,
  );
  assert.equal(result.textBlocks.length, 2500);
});
