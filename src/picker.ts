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
  style.textContent =
    "*{box-sizing:border-box}aside{position:fixed;right:16px;top:16px;width:380px;max-height:90vh;overflow:auto;background:#fff;color:#162c32;font:14px/1.5 system-ui;padding:16px;border:2px solid #126b61;border-radius:12px;pointer-events:auto;box-shadow:0 8px 40px #0004}button,input{font:inherit;margin:4px;padding:7px}button{cursor:pointer}input{width:95%}button:focus-visible,input:focus-visible{outline:3px solid #e98d18}pre{white-space:pre-wrap;max-height:150px;overflow:auto}#box{position:fixed;border:3px solid #109787;background:#10978720;pointer-events:none}";
  shadow.append(style);
  const box = document.createElement("div");
  box.id = "box";
  const panel = document.createElement("aside");
  const title = document.createElement("strong");
  title.textContent = "選取監控區域";
  panel.append(title);
  const help = document.createElement("p");
  help.textContent =
    "比較文字、連結及圖片網址；不比對截圖。點選區域後可調整。Esc 取消。不支援 iframe / Shadow DOM。";
  panel.append(help);
  const input = document.createElement("input");
  input.setAttribute("aria-label", "CSS selector");
  input.placeholder = "CSS selector";
  panel.append(input);
  const status = document.createElement("p"),
    preview = document.createElement("pre");
  panel.append(status, preview);
  let selected: Element | undefined,
    hover: Element | undefined,
    ignoreMode = false;
  let ignores: string[] = [];
  const button = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = fn;
    panel.append(b);
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
  function outline(e?: Element) {
    if (!e) return;
    const r = e.getBoundingClientRect();
    box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
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
      outline(selected);
      status.textContent = `唯一匹配 · ${result.images.length} 圖片網址 · 忽略 ${ignores.length} 區域${input.value.includes("nth-of-type") ? " · 路徑含位置索引，結構變動容易失配" : ""}`;
      preview.textContent = result.textBlocks.join("\n");
      confirm.disabled = false;
    } catch (e) {
      status.textContent = (e as Error).message;
      confirm.disabled = true;
    }
  }
  button("父元素", () => {
    if (selected?.parentElement) {
      selected = selected.parentElement;
      input.value = selector(selected);
      ignores = [];
      refresh();
    }
  });
  button("第一個子元素", () => {
    if (selected?.firstElementChild) {
      selected = selected.firstElementChild;
      input.value = selector(selected);
      ignores = [];
      refresh();
    }
  });
  const ignoreButton = button("點選忽略子區域", () => {
    ignoreMode = !ignoreMode;
    ignoreButton.textContent = ignoreMode
      ? "請點選根區域內的子元素"
      : "點選忽略子區域";
  });
  button("清除忽略", () => {
    ignores = [];
    refresh();
  });
  const confirm = button("確認並設定任務", () => {
    refresh();
    if (confirm.disabled) return;
    void chrome.runtime
      .sendMessage({
        type: "PICKED",
        selector: input.value,
        ignoreSelectors: ignores,
      })
      .then(() => cleanup())
      .catch((e) => {
        status.textContent = String(e);
      });
  });
  confirm.disabled = true;
  button("取消", () => cleanup());
  input.oninput = () => {
    ignores = [];
    refresh();
  };
  shadow.append(box, panel);
  document.documentElement.append(host);
  const move = (e: MouseEvent) => {
    if (e.composedPath().includes(host)) return;
    const el = e.target as Element;
    if (el instanceof Element) {
      hover = el;
      outline(el);
    }
  };
  const click = (e: MouseEvent) => {
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = e.target as Element;
    if (!(el instanceof Element) || el.tagName === "IFRAME" || el.shadowRoot) {
      status.textContent = "此區域為 iframe 或 Shadow DOM，不支援。";
      return;
    }
    if (ignoreMode) {
      if (selected && el !== selected && selected.contains(el)) {
        ignores.push(selector(el, selected));
        ignoreMode = false;
        ignoreButton.textContent = "點選忽略子區域";
        refresh();
      } else status.textContent = "請選擇根區域內的子元素。";
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
    window.__domWatchPickerCleanup = undefined;
  }
  window.__domWatchPickerCleanup = cleanup;
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("keydown", key, true);
  input.focus();
})();
