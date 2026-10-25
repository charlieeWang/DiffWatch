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
    style.textContent = `
    :host{all:initial}*{box-sizing:border-box}
    aside{position:fixed;right:16px;top:16px;width:min(380px,calc(100vw - 24px));max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#18343b;font:14px/1.6 system-ui;padding:20px;border:1px solid #bdd5cd;border-radius:16px;pointer-events:auto;box-shadow:0 10px 44px #12382d30}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:18px;margin:0}p{margin:10px 0;color:#49645b}
    button,input{font:inherit}button{cursor:pointer;border:1px solid #bcd2ca;border-radius:8px;background:white;color:#244e43;padding:9px 12px}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #e98d18;outline-offset:2px}
    .close{border:0;font-size:24px;padding:0 6px;line-height:1.3;color:#60766d}.modes{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px}.modes button{font-weight:600}.modes button[aria-pressed=true]{background:#146e63;border-color:#146e63;color:white}.modes button.ignore[aria-pressed=true]{background:#8a541c;border-color:#8a541c}
    #instruction{min-height:44px;margin:10px 0 14px}.preview{background:#edf7f2;border:1px solid #c5dfd2;border-radius:10px;padding:14px}.preview h3{font-size:14px;margin:0;color:#245741}.preview pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 system-ui;max-height:180px;overflow:auto;margin:10px 0 0;color:#203d32}.preview small{display:block;margin-top:8px;color:#557164}
    #status{font-size:13px;overflow-wrap:anywhere}.error{color:#a62d1e!important}.ignored{padding:0;list-style:none;margin:10px 0}.ignored li{display:flex;justify-content:space-between;align-items:center;gap:8px;background:#fff5e8;padding:7px 10px;border-radius:6px;margin:6px 0}.ignored span{overflow-wrap:anywhere}.ignored button{border:0;background:transparent;color:#8a541c;padding:2px 5px;flex-shrink:0}
    details{margin:14px 0;color:#5b7068}summary{cursor:pointer;font-size:13px}label{display:block;font-size:13px;margin-top:10px}input{display:block;width:100%;margin:6px 0 10px;padding:8px;border:1px solid #a6bdb3;border-radius:6px}.adjust{display:flex;gap:8px;flex-wrap:wrap}.adjust button{font-size:13px;padding:6px 9px}footer{border-top:1px solid #e0eae5;padding-top:14px;margin-top:14px}footer button{width:100%;background:#146e63;border-color:#146e63;color:white;font-weight:600}.note{font-size:12px;margin-bottom:0;color:#708178}
    #box,#selected-box{position:fixed;pointer-events:none;border:2px solid #109787;background:#10978716;display:none}#selected-box{border-style:dashed;background:transparent}#box.ignore{border-color:#bc762d;background:#bc762d20}
    @media(max-width:420px){aside{right:12px;top:12px;padding:16px;max-height:calc(100vh - 24px)}}
  `;
    shadow.append(style);
    const box = document.createElement("div");
    box.id = "box";
    const selectionBox = document.createElement("div");
    selectionBox.id = "selected-box";
    const panel = document.createElement("aside");
    panel.setAttribute("aria-label", "\u76E3\u63A7\u5340\u57DF\u8A2D\u5B9A");
    const header = document.createElement("header");
    const title = document.createElement("h2");
    title.textContent = "\u8A2D\u5B9A\u76E3\u63A7\u7BC4\u570D";
    header.append(title);
    panel.append(header);
    const help = document.createElement("p");
    help.textContent = "\u5148\u9078\u8981\u8FFD\u8E64\u7684\u7BC4\u570D\uFF0C\u518D\u6392\u9664\u4E0D\u60F3\u6BD4\u8F03\u7684\u5167\u5BB9\u3002";
    panel.append(help);
    const modes = document.createElement("div");
    modes.className = "modes";
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "\u9078\u5340\u6A21\u5F0F");
    const instruction = document.createElement("p");
    instruction.id = "instruction";
    instruction.setAttribute("role", "status");
    panel.append(modes, instruction);
    const previewPanel = document.createElement("section");
    previewPanel.className = "preview";
    const previewTitle = document.createElement("h3");
    previewTitle.textContent = "\u76E3\u63A7\u5167\u5BB9\u9810\u89BD";
    const preview = document.createElement("pre");
    preview.textContent = "\u5C1A\u672A\u9078\u53D6\u5340\u57DF\u3002\u8ACB\u9EDE\u9078\u7DB2\u9801\u4E0A\u7684\u5167\u5BB9\u3002";
    const counts = document.createElement("small");
    previewPanel.append(previewTitle, preview, counts);
    const status = document.createElement("p");
    status.id = "status";
    status.setAttribute("role", "status");
    const ignoredList = document.createElement("ul");
    ignoredList.className = "ignored";
    ignoredList.setAttribute("aria-label", "\u5DF2\u5FFD\u7565\u7684\u5340\u584A");
    panel.append(previewPanel, status, ignoredList);
    const advanced = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "\u9032\u968E\u8A2D\u5B9A";
    advanced.append(summary);
    const inputLabel = document.createElement("label");
    inputLabel.textContent = "\u624B\u52D5\u8ABF\u6574\u9078\u53D6\u898F\u5247\uFF08CSS\uFF09";
    const input = document.createElement("input");
    input.setAttribute("aria-label", "CSS selector");
    input.placeholder = "CSS selector";
    inputLabel.append(input);
    const adjust = document.createElement("div");
    adjust.className = "adjust";
    advanced.append(inputLabel, adjust);
    const footer = document.createElement("footer");
    panel.append(advanced, footer);
    let selected, hover, ignoreMode = false;
    let ignores = [];
    const button = (label, fn, container = panel) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.onclick = fn;
      b.type = "button";
      container.append(b);
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
    function outline(e, target = box) {
      if (!e) {
        target.style.display = "none";
        return;
      }
      const r = e.getBoundingClientRect();
      target.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    }
    function mode(ignore) {
      ignoreMode = ignore && !!selected;
      selectButton.setAttribute("aria-pressed", String(!ignoreMode));
      ignoreButton.setAttribute("aria-pressed", String(ignoreMode));
      ignoreButton.disabled = !selected;
      box.classList.toggle("ignore", ignoreMode);
      instruction.textContent = ignoreMode ? "\u9EDE\u9078\u7BC4\u570D\u5167\u4E0D\u60F3\u6BD4\u8F03\u7684\u5340\u584A\uFF0C\u53EF\u9023\u7E8C\u6392\u9664\u591A\u500B\u3002\u6A58\u8272\u6846\u8868\u793A\u5373\u5C07\u5FFD\u7565\u7684\u5167\u5BB9\u3002" : "\u5728\u7DB2\u9801\u4E0A\u79FB\u52D5\u6ED1\u9F20\uFF0C\u9EDE\u9078\u7DA0\u8272\u6846\u4E2D\u7684\u7BC4\u570D\uFF1B\u4E5F\u53EF\u4EE5\u91CD\u65B0\u9EDE\u9078\u3002";
    }
    function showError(message) {
      status.className = "error";
      status.textContent = message;
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
        outline(selected, selectionBox);
        status.className = "";
        status.textContent = `\u5DF2\u9078\u597D\u76E3\u63A7\u7BC4\u570D${ignores.length ? `\uFF0C\u5DF2\u5FFD\u7565 ${ignores.length} \u500B\u5340\u584A` : "\uFF0C\u53EF\u7E7C\u7E8C\u6392\u9664\u4E0D\u9700\u8981\u7684\u5167\u5BB9"}\u3002${input.value.includes("nth-of-type") ? "\u7DB2\u7AD9\u7248\u9762\u6539\u52D5\u5F8C\uFF0C\u53EF\u80FD\u9700\u8981\u91CD\u65B0\u9078\u53D6\u3002" : ""}`;
        preview.textContent = result.textBlocks.join("\n") || "\u9019\u500B\u7BC4\u570D\u6C92\u6709\u6587\u5B57\uFF0C\u4ECD\u53EF\u6BD4\u8F03\u9023\u7D50\u6216\u5716\u7247\u7DB2\u5740\u3002";
        counts.textContent = `${result.textBlocks.length} \u6BB5\u6587\u5B57 \xB7 ${result.links.length} \u500B\u9023\u7D50 \xB7 ${result.images.length} \u500B\u5716\u7247\u7DB2\u5740`;
        ignoredList.replaceChildren();
        ignores.forEach((sel, index) => {
          const item = document.createElement("li");
          const label = document.createElement("span");
          const node = selected.querySelector(sel);
          const text = node?.innerText?.replace(/\s+/g, " ").trim().slice(0, 32);
          label.textContent = `${index + 1}. ${text || "\u5716\u7247\u6216\u5176\u4ED6\u5167\u5BB9"}`;
          item.append(label);
          const undo = button(
            "\u6062\u5FA9",
            () => {
              ignores.splice(index, 1);
              refresh();
            },
            item
          );
          undo.setAttribute("aria-label", `\u6062\u5FA9\u5FFD\u7565\u5340\u584A ${index + 1}`);
          ignoredList.append(item);
        });
        confirm.disabled = false;
        mode(ignoreMode);
      } catch (e) {
        selected = void 0;
        outline(void 0, selectionBox);
        outline();
        preview.textContent = "\u7121\u6CD5\u9810\u89BD\uFF0C\u8ACB\u91CD\u65B0\u9078\u53D6\u76E3\u63A7\u5340\u57DF\u3002";
        counts.textContent = "";
        ignoredList.replaceChildren();
        const code = e.message;
        showError(
          code === "SELECTOR_MISSING" ? "\u627E\u4E0D\u5230\u9019\u500B\u7BC4\u570D\uFF0C\u8ACB\u91CD\u65B0\u9EDE\u9078\u7DB2\u9801\u5167\u5BB9\u3002" : code === "SELECTOR_AMBIGUOUS" ? "\u76EE\u524D\u9078\u5230\u4E86\u591A\u500B\u7BC4\u570D\uFF0C\u8ACB\u7E2E\u5C0F\u9078\u53D6\u7BC4\u570D\u3002" : code === "SNAPSHOT_TOO_LARGE" ? "\u9078\u53D6\u7BC4\u570D\u592A\u5927\uFF0C\u8ACB\u6539\u9078\u8F03\u5C0F\u7684\u5340\u57DF\u3002" : "\u7121\u6CD5\u8B80\u53D6\u9019\u500B\u7BC4\u570D\uFF0C\u8ACB\u91CD\u65B0\u9EDE\u9078\u6216\u6AA2\u67E5\u9032\u968E\u8A2D\u5B9A\u3002"
        );
        confirm.disabled = true;
        mode(false);
      }
    }
    const selectButton = button("\u9078\u53D6\u76E3\u63A7\u5340\u57DF", () => mode(false), modes);
    const ignoreButton = button("\u5FFD\u7565\u5340\u584A", () => mode(true), modes);
    ignoreButton.className = "ignore";
    button(
      "\u64F4\u5927\u9078\u53D6\u7BC4\u570D",
      () => {
        if (selected?.parentElement) {
          selected = selected.parentElement;
          input.value = selector(selected);
          ignores = [];
          refresh();
        }
      },
      adjust
    );
    button(
      "\u7E2E\u5C0F\u9078\u53D6\u7BC4\u570D",
      () => {
        if (selected?.firstElementChild) {
          selected = selected.firstElementChild;
          input.value = selector(selected);
          ignores = [];
          refresh();
        }
      },
      adjust
    );
    button(
      "\u6062\u5FA9\u5168\u90E8\u5FFD\u7565\u5167\u5BB9",
      () => {
        ignores = [];
        refresh();
      },
      adjust
    );
    const confirm = button(
      "\u4E0B\u4E00\u6B65\uFF1A\u8A2D\u5B9A\u76E3\u63A7",
      () => {
        refresh();
        if (confirm.disabled) return;
        void chrome.runtime.sendMessage({
          type: "PICKED",
          selector: input.value,
          ignoreSelectors: ignores
        }).then((response) => {
          if (!response?.ok) throw Error(response?.error || "\u7121\u6CD5\u958B\u555F\u4EFB\u52D9\u8A2D\u5B9A");
          cleanup();
        }).catch((e) => {
          showError(`\u7121\u6CD5\u958B\u555F\u8A2D\u5B9A\uFF0C\u8ACB\u518D\u8A66\u4E00\u6B21\u3002\uFF08${String(e)}\uFF09`);
        });
      },
      footer
    );
    confirm.disabled = true;
    const cancel = button("\xD7", () => cleanup(), header);
    cancel.className = "close";
    cancel.title = "\u53D6\u6D88\u9078\u5340\uFF08Esc\uFF09";
    cancel.setAttribute("aria-label", "\u53D6\u6D88\u9078\u5340");
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "\u6BD4\u8F03\u6587\u5B57\u3001\u9023\u7D50\u8207\u5716\u7247\u7DB2\u5740\uFF0C\u4E0D\u6BD4\u5C0D\u622A\u5716\u3002\u90E8\u5206\u5167\u5D4C\u5167\u5BB9\u7121\u6CD5\u9078\u53D6\u3002\u6309 Esc \u53EF\u53D6\u6D88\u3002";
    panel.append(note);
    input.oninput = () => {
      ignores = [];
      refresh();
    };
    mode(false);
    shadow.append(selectionBox, box, panel);
    document.documentElement.append(host);
    const move = (e) => {
      if (e.composedPath().includes(host)) return;
      const el = e.target;
      if (el instanceof Element) {
        hover = el;
        outline(
          ignoreMode && (!selected?.contains(el) || el === selected) ? void 0 : el
        );
      }
    };
    const click = (e) => {
      if (e.composedPath().includes(host)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = e.target;
      if (!(el instanceof Element) || el.tagName === "IFRAME" || el.shadowRoot) {
        showError("\u9019\u662F\u5167\u5D4C\u5167\u5BB9\uFF0C\u76EE\u524D\u7121\u6CD5\u9078\u53D6\uFF0C\u8ACB\u6539\u9078\u5176\u4ED6\u5340\u57DF\u3002");
        return;
      }
      if (ignoreMode) {
        if (selected && el !== selected && selected.contains(el)) {
          const sel = selector(el, selected);
          if (!ignores.includes(sel)) ignores.push(sel);
          refresh();
        } else
          showError("\u8ACB\u9EDE\u9078\u5DF2\u9078\u7BC4\u570D\u88E1\u9762\u7684\u4E00\u500B\u5C0F\u5340\u584A\uFF0C\u4E0D\u80FD\u5FFD\u7565\u6574\u500B\u76E3\u63A7\u7BC4\u570D\u3002");
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
        if (ignoreMode) {
          if (selected && hover !== selected && selected.contains(hover)) {
            const sel = selector(hover, selected);
            if (!ignores.includes(sel)) ignores.push(sel);
            refresh();
          }
          return;
        }
        selected = hover;
        ignores = [];
        input.value = selector(hover);
        refresh();
        confirm.focus();
      }
    };
    const redraw = () => {
      outline(selected, selectionBox);
      outline();
    };
    function cleanup() {
      host.remove();
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", redraw, true);
      window.removeEventListener("resize", redraw);
      window.__domWatchPickerCleanup = void 0;
    }
    window.__domWatchPickerCleanup = cleanup;
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", redraw, true);
    window.addEventListener("resize", redraw);
    selectButton.focus();
  })();
})();
//# sourceMappingURL=picker.js.map
