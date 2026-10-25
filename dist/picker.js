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

  // src/picker.ts
  window.__domWatchPickerCleanup?.();
  (() => {
    if (!document.contentType.includes("html")) return;
    const host = document.createElement("div");
    host.dataset.domWatchOverlay = "true";
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = "*{box-sizing:border-box}aside{position:fixed;right:16px;top:16px;width:380px;max-height:90vh;overflow:auto;background:#fff;color:#162c32;font:14px/1.5 system-ui;padding:16px;border:2px solid #126b61;border-radius:12px;pointer-events:auto;box-shadow:0 8px 40px #0004}button,input{font:inherit;margin:4px;padding:7px}button{cursor:pointer}input{width:95%}button:focus-visible,input:focus-visible{outline:3px solid #e98d18}pre{white-space:pre-wrap;max-height:150px;overflow:auto}#box{position:fixed;border:3px solid #109787;background:#10978720;pointer-events:none}";
    shadow.append(style);
    const box = document.createElement("div");
    box.id = "box";
    const panel = document.createElement("aside");
    const title = document.createElement("strong");
    title.textContent = "\u9078\u53D6\u76E3\u63A7\u5340\u57DF";
    panel.append(title);
    const help = document.createElement("p");
    help.textContent = "\u6BD4\u8F03\u6587\u5B57\u3001\u9023\u7D50\u53CA\u5716\u7247\u7DB2\u5740\uFF1B\u4E0D\u6BD4\u5C0D\u622A\u5716\u3002\u9EDE\u9078\u5340\u57DF\u5F8C\u53EF\u8ABF\u6574\u3002Esc \u53D6\u6D88\u3002\u4E0D\u652F\u63F4 iframe / Shadow DOM\u3002";
    panel.append(help);
    const input = document.createElement("input");
    input.setAttribute("aria-label", "CSS selector");
    input.placeholder = "CSS selector";
    panel.append(input);
    const status = document.createElement("p"), preview = document.createElement("pre");
    panel.append(status, preview);
    let selected, hover, ignoreMode = false;
    let ignores = [];
    const button = (label, fn) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = fn;
      panel.append(b);
      return b;
    };
    function unique(sel, scope) {
      try {
        return scope.querySelectorAll(sel).length === 1;
      } catch {
        return false;
      }
    }
    function selector(el, scope = document) {
      const esc = CSS.escape;
      if (el.id && !/[0-9a-f]{8,}|\d{5,}/i.test(el.id) && unique("#" + esc(el.id), scope))
        return "#" + esc(el.id);
      for (const attr of [
        "data-testid",
        "data-test",
        "aria-label",
        "role",
        "name"
      ]) {
        const value = el.getAttribute(attr);
        if (value && value.length < 100) {
          const s = el.tagName.toLowerCase() + "[" + attr + '="' + esc(value) + '"]';
          if (unique(s, scope)) return s;
        }
      }
      const classes = [...el.classList].filter((c) => !/[0-9a-f]{8,}|\d{4,}/i.test(c)).slice(0, 3);
      const base = el.tagName.toLowerCase() + classes.map((c) => "." + esc(c)).join("");
      if (unique(base, scope)) return base;
      const parts = [];
      let current = el;
      while (current && current !== scope) {
        let part = current.tagName.toLowerCase();
        const siblings = current.parentElement ? [...current.parentElement.children].filter(
          (e) => e.tagName === current.tagName
        ) : [];
        if (siblings.length > 1)
          part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        parts.unshift(part);
        const path = parts.join(" > ");
        if (unique(path, scope)) return path;
        current = current.parentElement;
      }
      return parts.join(" > ");
    }
    function outline(e) {
      if (!e) return;
      const r = e.getBoundingClientRect();
      box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    }
    function refresh() {
      try {
        const c = {
          name: "\u9810\u89BD",
          url: location.href,
          origin: location.origin,
          selector: input.value,
          ignoreSelectors: ignores,
          captureOptions: { text: true, links: true, images: true },
          allowEmpty: true,
          intervalMinutes: 5,
          settleDelayMs: 2e3,
          notifications: true
        };
        const result = extract(document, c);
        selected = document.querySelector(input.value);
        outline(selected);
        status.textContent = `\u552F\u4E00\u5339\u914D \xB7 ${result.images.length} \u5716\u7247\u7DB2\u5740 \xB7 \u5FFD\u7565 ${ignores.length} \u5340\u57DF${input.value.includes("nth-of-type") ? " \xB7 \u8DEF\u5F91\u542B\u4F4D\u7F6E\u7D22\u5F15\uFF0C\u7D50\u69CB\u8B8A\u52D5\u5BB9\u6613\u5931\u914D" : ""}`;
        preview.textContent = result.textBlocks.join("\n");
        confirm.disabled = false;
      } catch (e) {
        status.textContent = e.message;
        confirm.disabled = true;
      }
    }
    button("\u7236\u5143\u7D20", () => {
      if (selected?.parentElement) {
        selected = selected.parentElement;
        input.value = selector(selected);
        ignores = [];
        refresh();
      }
    });
    button("\u7B2C\u4E00\u500B\u5B50\u5143\u7D20", () => {
      if (selected?.firstElementChild) {
        selected = selected.firstElementChild;
        input.value = selector(selected);
        ignores = [];
        refresh();
      }
    });
    const ignoreButton = button("\u9EDE\u9078\u5FFD\u7565\u5B50\u5340\u57DF", () => {
      ignoreMode = !ignoreMode;
      ignoreButton.textContent = ignoreMode ? "\u8ACB\u9EDE\u9078\u6839\u5340\u57DF\u5167\u7684\u5B50\u5143\u7D20" : "\u9EDE\u9078\u5FFD\u7565\u5B50\u5340\u57DF";
    });
    button("\u6E05\u9664\u5FFD\u7565", () => {
      ignores = [];
      refresh();
    });
    const confirm = button("\u78BA\u8A8D\u4E26\u8A2D\u5B9A\u4EFB\u52D9", () => {
      refresh();
      if (confirm.disabled) return;
      void chrome.runtime.sendMessage({
        type: "PICKED",
        selector: input.value,
        ignoreSelectors: ignores
      }).then(() => cleanup()).catch((e) => {
        status.textContent = String(e);
      });
    });
    confirm.disabled = true;
    button("\u53D6\u6D88", () => cleanup());
    input.oninput = () => {
      ignores = [];
      refresh();
    };
    shadow.append(box, panel);
    document.documentElement.append(host);
    const move = (e) => {
      if (e.composedPath().includes(host)) return;
      const el = e.target;
      if (el instanceof Element) {
        hover = el;
        outline(el);
      }
    };
    const click = (e) => {
      if (e.composedPath().includes(host)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = e.target;
      if (!(el instanceof Element) || el.tagName === "IFRAME" || el.shadowRoot) {
        status.textContent = "\u6B64\u5340\u57DF\u70BA iframe \u6216 Shadow DOM\uFF0C\u4E0D\u652F\u63F4\u3002";
        return;
      }
      if (ignoreMode) {
        if (selected && el !== selected && selected.contains(el)) {
          ignores.push(selector(el, selected));
          ignoreMode = false;
          ignoreButton.textContent = "\u9EDE\u9078\u5FFD\u7565\u5B50\u5340\u57DF";
          refresh();
        } else status.textContent = "\u8ACB\u9078\u64C7\u6839\u5340\u57DF\u5167\u7684\u5B50\u5143\u7D20\u3002";
        return;
      }
      selected = el;
      ignores = [];
      input.value = selector(el);
      refresh();
    };
    const key = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
      }
      if (e.key === "Enter" && !e.composedPath().includes(host) && hover) {
        e.preventDefault();
        selected = hover;
        input.value = selector(hover);
        refresh();
        input.focus();
      }
    };
    function cleanup() {
      host.remove();
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      window.__domWatchPickerCleanup = void 0;
    }
    window.__domWatchPickerCleanup = cleanup;
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    input.focus();
  })();
})();
//# sourceMappingURL=picker.js.map
