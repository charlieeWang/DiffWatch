"use strict";
(() => {
  // src/core.ts
  var LIMIT = 256 * 1024;
  var cleanText = (s) => s.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\s+/gu, " ").trim();
  function canonical(c) {
    return JSON.stringify({
      normalizationVersion: 1,
      captureOptions: c.captureOptions,
      textBlocks: c.captureOptions.text ? c.textBlocks : [],
      links: c.captureOptions.links ? c.links : [],
      images: c.captureOptions.images ? c.images : []
    });
  }
  function extract(doc, c) {
    if (!doc.contentType.includes("html")) throw Error("UNSUPPORTED_URL");
    if (c.failureSelector && doc.querySelector(c.failureSelector))
      throw Error("LOGIN_OR_ERROR_DETECTED");
    if (c.readinessSelector && !doc.querySelector(c.readinessSelector))
      throw Error("NOT_READY");
    const roots = doc.querySelectorAll(c.selector);
    if (!roots.length) throw Error("SELECTOR_MISSING");
    if (roots.length !== 1) throw Error("SELECTOR_AMBIGUOUS");
    const root = roots[0];
    const ignored = /* @__PURE__ */ new Set();
    for (const sel of c.ignoreSelectors)
      for (const e of root.querySelectorAll(sel)) ignored.add(e);
    const textBlocks = [], links = [], images = [];
    let line = "", count = 0;
    const flush = () => {
      const t = cleanText(line);
      if (t) textBlocks.push(t);
      line = "";
    };
    const block = new Set(
      "ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION TABLE TBODY TD TH THEAD TR UL BR".split(
        " "
      )
    );
    function walk(n) {
      if (++count > 2e4) throw Error("SNAPSHOT_TOO_LARGE");
      if (n.nodeType === 3) {
        line += n.textContent || "";
        return;
      }
      if (n.nodeType !== 1) return;
      const e = n;
      if (ignored.has(e) || e.matches(
        'script,style,noscript,template,input,textarea,select,[data-dom-watch-overlay],[hidden],[aria-hidden="true"]'
      ))
        return;
      const style = doc.defaultView.getComputedStyle(e);
      if (style.display === "none" || ["hidden", "collapse"].includes(style.visibility))
        return;
      const isBlock = block.has(e.tagName);
      if (isBlock) flush();
      if (e.tagName === "A") {
        const a = e;
        try {
          links.push({
            href: new URL(a.getAttribute("href") || "", doc.baseURI).href,
            text: ""
          });
          const idx = links.length - 1;
          const begin = textBlocks.length, old = line;
          for (const child of e.childNodes) walk(child);
          links[idx].text = cleanText(
            [...textBlocks.slice(begin), line.slice(old.length)].join(" ")
          );
          if (isBlock) flush();
          return;
        } catch {
        }
      }
      if (e.tagName === "IMG") {
        const i = e;
        const src = i.currentSrc || i.getAttribute("src");
        if (src) {
          try {
            images.push({
              src: new URL(src, doc.baseURI).href,
              alt: cleanText(i.alt)
            });
          } catch {
          }
        }
      }
      for (const child of e.childNodes) walk(child);
      if (isBlock) flush();
    }
    walk(root);
    flush();
    const result = {
      normalizationVersion: 1,
      captureOptions: c.captureOptions,
      textBlocks: c.captureOptions.text ? textBlocks : [],
      links: c.captureOptions.links ? links : [],
      images: c.captureOptions.images ? images : []
    };
    if (new TextEncoder().encode(canonical(result)).length > LIMIT)
      throw Error("SNAPSHOT_TOO_LARGE");
    if (!c.allowEmpty && !result.textBlocks.length && !result.links.length && !result.images.length)
      throw Error("EMPTY_CONTENT");
    return result;
  }

  // src/capture.ts
  function startCapture(c, runId, monitorId, configVersion, deadlineAt) {
    const runs = window.__domWatchRuns ??= /* @__PURE__ */ new Set();
    (window.__domWatchOwnedRuns ??= /* @__PURE__ */ new Set()).add(runId);
    if (runs.has(runId)) return;
    runs.add(runId);
    void (async () => {
      let previous = "", count = 0, first = 0;
      let code = "UNSTABLE_CONTENT";
      try {
        await new Promise((r) => setTimeout(r, c.settleDelayMs));
        while (Date.now() < deadlineAt) {
          try {
            const content = extract(document, c), value = canonical(content);
            if (value === previous) count++;
            else {
              previous = value;
              count = 1;
              first = Date.now();
            }
            if (count >= 3 && Date.now() - first >= 2e3) {
              await chrome.runtime.sendMessage({
                type: "CAPTURE_RESULT",
                runId,
                monitorId,
                configVersion,
                content,
                finalUrl: location.href
              });
              return;
            }
            code = "UNSTABLE_CONTENT";
          } catch (e) {
            code = e.message;
            previous = "";
            count = 0;
            if (!["NOT_READY", "SELECTOR_MISSING"].includes(code)) throw e;
          }
          await new Promise((r) => setTimeout(r, 1e3));
        }
        throw Error(code === "NOT_READY" ? "LOAD_TIMEOUT" : code);
      } catch (e) {
        await chrome.runtime.sendMessage({
          type: "CAPTURE_ERROR",
          runId,
          monitorId,
          configVersion,
          code: e.message
        }).catch(() => {
        });
      } finally {
        runs.delete(runId);
      }
    })();
  }
  if (!window.__domWatchCaptureInstalled) {
    window.__domWatchCaptureInstalled = true;
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message.type === "CAPTURE_START") {
        startCapture(
          message.config,
          message.runId,
          message.monitorId,
          message.configVersion,
          message.deadlineAt
        );
        reply({ ok: true });
      }
      if (message.type === "PROBE")
        reply({ runIds: [...window.__domWatchOwnedRuns || []] });
      if (message.type === "PREVIEW") {
        try {
          const started = performance.now();
          const content = extract(document, message.config);
          reply({
            ok: true,
            content,
            durationMs: performance.now() - started,
            byteLength: new TextEncoder().encode(canonical(content)).length
          });
        } catch (e) {
          reply({ ok: false, error: e.message });
        }
      }
    });
  }
})();
//# sourceMappingURL=capture.js.map
