import { extract, type Config } from "./core";
declare global {
  interface Window {
    __domWatchPickerCleanup?: () => void;
    __domWatchCaptureInstalled?: boolean;
  }
}
window.__domWatchPickerCleanup?.();
(() => {
  if (!document.contentType.includes("html")) return;
  const host = document.createElement("div");
  host.dataset.domWatchOverlay = "true";
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
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
  panel.setAttribute("aria-label", "監控區域設定");
  const header = document.createElement("header");
  const title = document.createElement("h2");
  title.textContent = "設定監控範圍";
  header.append(title);
  panel.append(header);
  const help = document.createElement("p");
  help.textContent = "先選要追蹤的範圍，再排除不想比較的內容。";
  panel.append(help);
  const modes = document.createElement("div");
  modes.className = "modes";
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "選區模式");
  const instruction = document.createElement("p");
  instruction.id = "instruction";
  instruction.setAttribute("role", "status");
  panel.append(modes, instruction);
  const previewPanel = document.createElement("section");
  previewPanel.className = "preview";
  const previewTitle = document.createElement("h3");
  previewTitle.textContent = "監控內容預覽";
  const preview = document.createElement("pre");
  preview.textContent = "尚未選取區域。請點選網頁上的內容。";
  const counts = document.createElement("small");
  previewPanel.append(previewTitle, preview, counts);
  const status = document.createElement("p");
  status.id = "status";
  status.setAttribute("role", "status");
  const ignoredList = document.createElement("ul");
  ignoredList.className = "ignored";
  ignoredList.setAttribute("aria-label", "已忽略的區塊");
  panel.append(previewPanel, status, ignoredList);
  const advanced = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "進階設定";
  advanced.append(summary);
  const inputLabel = document.createElement("label");
  inputLabel.textContent = "手動調整選取規則（CSS）";
  const input = document.createElement("input");
  input.setAttribute("aria-label", "CSS selector");
  input.placeholder = "CSS selector";
  inputLabel.append(input);
  const adjust = document.createElement("div");
  adjust.className = "adjust";
  advanced.append(inputLabel, adjust);
  const footer = document.createElement("footer");
  panel.append(advanced, footer);
  let selected: Element | undefined,
    hover: Element | undefined,
    ignoreMode = false;
  let ignores: string[] = [];
  const button = (
    label: string,
    fn: () => void,
    container: HTMLElement = panel,
  ) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    b.type = "button";
    container.append(b);
    return b;
  };
  function unique(sel: string, scope: ParentNode) {
    try {
      return scope.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  }
  function selector(el: Element, scope: ParentNode = document): string {
    const esc = CSS.escape;
    if (
      el.id &&
      !/[0-9a-f]{8,}|\d{5,}/i.test(el.id) &&
      unique("#" + esc(el.id), scope)
    )
      return "#" + esc(el.id);
    for (const attr of [
      "data-testid",
      "data-test",
      "aria-label",
      "role",
      "name",
    ]) {
      const value = el.getAttribute(attr);
      if (value && value.length < 100) {
        const s =
          el.tagName.toLowerCase() + "[" + attr + '="' + esc(value) + '"]';
        if (unique(s, scope)) return s;
      }
    }
    const classes = [...el.classList]
      .filter((c) => !/[0-9a-f]{8,}|\d{4,}/i.test(c))
      .slice(0, 3);
    const base =
      el.tagName.toLowerCase() + classes.map((c) => "." + esc(c)).join("");
    if (unique(base, scope)) return base;
    const parts: string[] = [];
    let current: Element | null = el;
    while (current && current !== scope) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(
            (e) => e.tagName === current!.tagName,
          )
        : [];
      if (siblings.length > 1)
        part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
      parts.unshift(part);
      const path = parts.join(" > ");
      if (unique(path, scope)) return path;
      current = current.parentElement;
    }
    return parts.join(" > ");
  }
  function outline(e?: Element, target = box) {
    if (!e) {
      target.style.display = "none";
      return;
    }
    const r = e.getBoundingClientRect();
    target.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  }
  function mode(ignore: boolean) {
    ignoreMode = ignore && !!selected;
    selectButton.setAttribute("aria-pressed", String(!ignoreMode));
    ignoreButton.setAttribute("aria-pressed", String(ignoreMode));
    ignoreButton.disabled = !selected;
    box.classList.toggle("ignore", ignoreMode);
    instruction.textContent = ignoreMode
      ? "點選範圍內不想比較的區塊，可連續排除多個。橘色框表示即將忽略的內容。"
      : "在網頁上移動滑鼠，點選綠色框中的範圍；也可以重新點選。";
  }
  function showError(message: string) {
    status.className = "error";
    status.textContent = message;
  }
  function refresh() {
    try {
      const c: Config = {
        name: "預覽",
        url: location.href,
        origin: location.origin,
        selector: input.value,
        ignoreSelectors: ignores,
        captureOptions: { text: true, links: true, images: true },
        allowEmpty: true,
        intervalMinutes: 5,
        settleDelayMs: 2000,
        notifications: true,
      };
      const result = extract(document, c);
      selected = document.querySelector(input.value)!;
      outline(selected, selectionBox);
      status.className = "";
      status.textContent = `已選好監控範圍${ignores.length ? `，已忽略 ${ignores.length} 個區塊` : "，可繼續排除不需要的內容"}。${input.value.includes("nth-of-type") ? "網站版面改動後，可能需要重新選取。" : ""}`;
      preview.textContent =
        result.textBlocks.join("\n") ||
        "這個範圍沒有文字，仍可比較連結或圖片網址。";
      counts.textContent = `${result.textBlocks.length} 段文字 · ${result.links.length} 個連結 · ${result.images.length} 個圖片網址`;
      ignoredList.replaceChildren();
      ignores.forEach((sel, index) => {
        const item = document.createElement("li");
        const label = document.createElement("span");
        const node = selected!.querySelector<HTMLElement>(sel);
        const text = node?.innerText?.replace(/\s+/g, " ").trim().slice(0, 32);
        label.textContent = `${index + 1}. ${text || "圖片或其他內容"}`;
        item.append(label);
        const undo = button(
          "恢復",
          () => {
            ignores.splice(index, 1);
            refresh();
          },
          item,
        );
        undo.setAttribute("aria-label", `恢復忽略區塊 ${index + 1}`);
        ignoredList.append(item);
      });
      confirm.disabled = false;
      mode(ignoreMode);
    } catch (e) {
      selected = undefined;
      outline(undefined, selectionBox);
      outline();
      preview.textContent = "無法預覽，請重新選取監控區域。";
      counts.textContent = "";
      ignoredList.replaceChildren();
      const code = (e as Error).message;
      showError(
        code === "SELECTOR_MISSING"
          ? "找不到這個範圍，請重新點選網頁內容。"
          : code === "SELECTOR_AMBIGUOUS"
            ? "目前選到了多個範圍，請縮小選取範圍。"
            : code === "SNAPSHOT_TOO_LARGE"
              ? "選取範圍太大，請改選較小的區域。"
              : "無法讀取這個範圍，請重新點選或檢查進階設定。",
      );
      confirm.disabled = true;
      mode(false);
    }
  }
  const selectButton = button("選取監控區域", () => mode(false), modes);
  const ignoreButton = button("忽略區塊", () => mode(true), modes);
  ignoreButton.className = "ignore";
  button(
    "擴大選取範圍",
    () => {
      if (selected?.parentElement) {
        selected = selected.parentElement;
        input.value = selector(selected);
        ignores = [];
        refresh();
      }
    },
    adjust,
  );
  button(
    "縮小選取範圍",
    () => {
      if (selected?.firstElementChild) {
        selected = selected.firstElementChild;
        input.value = selector(selected);
        ignores = [];
        refresh();
      }
    },
    adjust,
  );
  button(
    "恢復全部忽略內容",
    () => {
      ignores = [];
      refresh();
    },
    adjust,
  );
  const confirm = button(
    "下一步：設定監控",
    () => {
      refresh();
      if (confirm.disabled) return;
      void chrome.runtime
        .sendMessage({
          type: "PICKED",
          selector: input.value,
          ignoreSelectors: ignores,
        })
        .then((response) => {
          if (!response?.ok) throw Error(response?.error || "無法開啟任務設定");
          cleanup();
        })
        .catch((e) => {
          showError(`無法開啟設定，請再試一次。（${String(e)}）`);
        });
    },
    footer,
  );
  confirm.disabled = true;
  const cancel = button("×", () => cleanup(), header);
  cancel.className = "close";
  cancel.title = "取消選區（Esc）";
  cancel.setAttribute("aria-label", "取消選區");
  const note = document.createElement("p");
  note.className = "note";
  note.textContent =
    "比較文字、連結與圖片網址，不比對截圖。部分內嵌內容無法選取。按 Esc 可取消。";
  panel.append(note);
  input.oninput = () => {
    ignores = [];
    refresh();
  };
  mode(false);
  shadow.append(selectionBox, box, panel);
  document.documentElement.append(host);
  const move = (e: MouseEvent) => {
    if (e.composedPath().includes(host)) return;
    const el = e.target as Element;
    if (el instanceof Element) {
      hover = el;
      outline(
        ignoreMode && (!selected?.contains(el) || el === selected)
          ? undefined
          : el,
      );
    }
  };
  const click = (e: MouseEvent) => {
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = e.target as Element;
    if (!(el instanceof Element) || el.tagName === "IFRAME" || el.shadowRoot) {
      showError("這是內嵌內容，目前無法選取，請改選其他區域。");
      return;
    }
    if (ignoreMode) {
      if (selected && el !== selected && selected.contains(el)) {
        const sel = selector(el, selected);
        if (!ignores.includes(sel)) ignores.push(sel);
        refresh();
      } else
        showError("請點選已選範圍裡面的一個小區塊，不能忽略整個監控範圍。");
      return;
    }
    selected = el;
    ignores = [];
    input.value = selector(el);
    refresh();
  };
  const key = (e: KeyboardEvent) => {
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
    window.__domWatchPickerCleanup = undefined;
  }
  window.__domWatchPickerCleanup = cleanup;
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  window.addEventListener("scroll", redraw, true);
  window.addEventListener("resize", redraw);
  selectButton.focus();
})();
