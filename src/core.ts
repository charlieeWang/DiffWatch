export const NORMALIZATION_VERSION = 1;
export const LIMIT = 256 * 1024;
export type CaptureOptions = { text: boolean; links: boolean; images: boolean };
export type Content = {
  normalizationVersion: number;
  captureOptions: CaptureOptions;
  textBlocks: string[];
  links: { href: string; text: string }[];
  images: { src: string; alt: string }[];
};
export type Config = {
  name: string;
  url: string;
  origin: string;
  selector: string;
  ignoreSelectors: string[];
  captureOptions: CaptureOptions;
  readinessSelector?: string;
  failureSelector?: string;
  allowEmpty: boolean;
  intervalMinutes: number;
  settleDelayMs: number;
  notifications: boolean;
};
export type Monitor = Config & {
  id: string;
  enabled: boolean;
  health: string;
  configVersion: number;
  baselineSnapshotId?: string;
  nextDueAt: number;
  lastAttemptAt?: number;
  lastSuccessAt?: number;
  lastChangeAt?: number;
  consecutiveFailures: number;
  errorNotifiedCode?: string;
  lastError?: {
    code: string;
    userMessage: string;
    occurredAt: number;
    diagnosticId: string;
  };
  createdAt: number;
  updatedAt: number;
};
export type Snapshot = Content & {
  id: string;
  monitorId: string;
  runId: string;
  configVersion: number;
  capturedAt: number;
  finalUrl: string;
  hash: string;
  byteLength: number;
};
export type Job = {
  runId: string;
  monitorId: string;
  configVersion: number;
  phase: string;
  tabId?: number;
  documentId?: string;
  startedAt: number;
  deadlineAt: number;
  leaseUntil: number;
  attempt: number;
  session: string;
  error?: string;
};
export type ChangeEvent = {
  id: string;
  monitorId: string;
  runId: string;
  configVersion: number;
  beforeSnapshotId: string;
  afterSnapshotId: string;
  detectedAt: number;
  summary: string;
  readAt?: number;
};
export type Outbox = {
  eventId: string;
  notificationId: string;
  state: "pending" | "sent" | "failed";
  attempts: number;
  lastError?: string;
  updatedAt: number;
};
export const cleanText = (s: string) =>
  s.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\s+/gu, " ").trim();
export function urlOf(raw: string) {
  const u = new URL(raw);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hostname === "chromewebstore.google.com" ||
    (u.hostname === "chrome.google.com" && u.pathname.startsWith("/webstore"))
  )
    throw Error("UNSUPPORTED_URL");
  u.hash = "";
  return u;
}
export function config(raw: unknown): Config {
  if (!raw || typeof raw !== "object") throw Error("INVALID_CONFIG");
  const v = raw as Record<string, any>;
  const str = (k: string, max = 2048) => {
    if (typeof v[k] !== "string" || v[k].length > max)
      throw Error("INVALID_" + k);
    return v[k].trim();
  };
  const u = urlOf(str("url"));
  const name = str("name", 120),
    selector = str("selector", 4096);
  if (
    !name ||
    !selector ||
    !Array.isArray(v.ignoreSelectors) ||
    v.ignoreSelectors.length > 50 ||
    !v.ignoreSelectors.every(
      (s: unknown) => typeof s === "string" && s.length > 0 && s.length < 4096,
    )
  )
    throw Error("INVALID_CONFIG");
  const o = v.captureOptions;
  if (
    !o ||
    !["text", "links", "images"].every((k) => typeof o[k] === "boolean") ||
    !Object.values(o).some(Boolean)
  )
    throw Error("INVALID_OPTIONS");
  if (
    !Number.isInteger(v.intervalMinutes) ||
    v.intervalMinutes < 1 ||
    v.intervalMinutes > 1440 ||
    !Number.isInteger(v.settleDelayMs) ||
    v.settleDelayMs < 0 ||
    v.settleDelayMs > 30000
  )
    throw Error("INVALID_INTERVAL");
  for (const k of ["readinessSelector", "failureSelector"])
    if (v[k] !== undefined && (typeof v[k] !== "string" || v[k].length > 4096))
      throw Error("INVALID_SELECTOR");
  return {
    name,
    url: u.href,
    origin: u.origin,
    selector,
    ignoreSelectors: v.ignoreSelectors,
    captureOptions: { text: o.text, links: o.links, images: o.images },
    readinessSelector: v.readinessSelector || undefined,
    failureSelector: v.failureSelector || undefined,
    allowEmpty: v.allowEmpty === true,
    intervalMinutes: v.intervalMinutes,
    settleDelayMs: v.settleDelayMs,
    notifications: v.notifications !== false,
  };
}
export function canonical(c: Content) {
  return JSON.stringify({
    normalizationVersion: 1,
    captureOptions: c.captureOptions,
    textBlocks: c.captureOptions.text ? c.textBlocks : [],
    links: c.captureOptions.links ? c.links : [],
    images: c.captureOptions.images ? c.images : [],
  });
}
export async function digest(c: Content) {
  const bytes = new TextEncoder().encode(canonical(c));
  if (bytes.length > LIMIT) throw Error("SNAPSHOT_TOO_LARGE");
  return {
    hash: Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    byteLength: bytes.length,
  };
}
export const changed = (a: Content, b: Content) =>
  canonical(a) !== canonical(b);
export const backoff = (interval: number, failures: number) =>
  Math.max(interval, Math.min(60, 2 ** Math.min(20, failures - 1))) * 60000;
// Exact ordered LCS for ordinary regions, bounded replacement for very large edits.
export function diff<T>(a: T[], b: T[]) {
  const ak = a.map((x) => JSON.stringify(x)),
    bk = b.map((x) => JSON.stringify(x));
  let p = 0,
    s = 0;
  while (p < a.length && p < b.length && ak[p] === bk[p]) p++;
  while (
    s < a.length - p &&
    s < b.length - p &&
    ak[a.length - 1 - s] === bk[b.length - 1 - s]
  )
    s++;
  const out: { kind: string; value: T }[] = a
    .slice(0, p)
    .map((value) => ({ kind: "same", value }));
  const n = a.length - p - s,
    m = b.length - p - s;
  if ((n + 1) * (m + 1) <= 1000000) {
    const rows = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        rows[i][j] =
          ak[p + i] === bk[p + j]
            ? rows[i + 1][j + 1] + 1
            : Math.max(rows[i + 1][j], rows[i][j + 1]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && ak[p + i] === bk[p + j]) {
        out.push({ kind: "same", value: a[p + i++] });
        j++;
      } else if (i < n && (j === m || rows[i + 1][j] >= rows[i][j + 1]))
        out.push({ kind: "removed", value: a[p + i++] });
      else out.push({ kind: "added", value: b[p + j++] });
    }
  } else {
    out.push(
      ...a.slice(p, a.length - s).map((value) => ({ kind: "removed", value })),
      ...b.slice(p, b.length - s).map((value) => ({ kind: "added", value })),
    );
  }
  out.push(...a.slice(a.length - s).map((value) => ({ kind: "same", value })));
  return out;
}
export function extract(doc: Document, c: Config): Content {
  if (!doc.contentType.includes("html")) throw Error("UNSUPPORTED_URL");
  if (c.failureSelector && doc.querySelector(c.failureSelector))
    throw Error("LOGIN_OR_ERROR_DETECTED");
  if (c.readinessSelector && !doc.querySelector(c.readinessSelector))
    throw Error("NOT_READY");
  const roots = doc.querySelectorAll(c.selector);
  if (!roots.length) throw Error("SELECTOR_MISSING");
  if (roots.length !== 1) throw Error("SELECTOR_AMBIGUOUS");
  const root = roots[0];
  const ignored = new Set<Element>();
  for (const sel of c.ignoreSelectors)
    for (const e of root.querySelectorAll(sel)) ignored.add(e);
  const textBlocks: string[] = [],
    links: Content["links"] = [],
    images: Content["images"] = [];
  let line = "",
    count = 0;
  const flush = () => {
    const t = cleanText(line);
    if (t) textBlocks.push(t);
    line = "";
  };
  const block = new Set(
    "ADDRESS ARTICLE ASIDE BLOCKQUOTE DD DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P PRE SECTION TABLE TBODY TD TH THEAD TR UL BR".split(
      " ",
    ),
  );
  function walk(n: Node) {
    if (++count > 20000) throw Error("SNAPSHOT_TOO_LARGE");
    if (n.nodeType === 3) {
      line += n.textContent || "";
      return;
    }
    if (n.nodeType !== 1) return;
    const e = n as HTMLElement;
    if (
      ignored.has(e) ||
      e.matches(
        'script,style,noscript,template,input,textarea,select,[data-dom-watch-overlay],[hidden],[aria-hidden="true"]',
      )
    )
      return;
    const style = doc.defaultView!.getComputedStyle(e);
    if (
      style.display === "none" ||
      ["hidden", "collapse"].includes(style.visibility)
    )
      return;
    const isBlock = block.has(e.tagName);
    if (isBlock) flush();
    if (e.tagName === "A") {
      const a = e as HTMLAnchorElement;
      try {
        links.push({
          href: new URL(a.getAttribute("href") || "", doc.baseURI).href,
          text: "",
        });
        const idx = links.length - 1;
        const begin = textBlocks.length,
          old = line;
        for (const child of e.childNodes) walk(child);
        links[idx].text = cleanText(
          [...textBlocks.slice(begin), line.slice(old.length)].join(" "),
        );
        if (isBlock) flush();
        return;
      } catch {}
    }
    if (e.tagName === "IMG") {
      const i = e as HTMLImageElement;
      const src = i.currentSrc || i.getAttribute("src");
      if (src) {
        try {
          images.push({
            src: new URL(src, doc.baseURI).href,
            alt: cleanText(i.alt),
          });
        } catch {}
      }
    }
    for (const child of e.childNodes) walk(child);
    if (isBlock) flush();
  }
  walk(root);
  flush();
  const result: Content = {
    normalizationVersion: 1,
    captureOptions: c.captureOptions,
    textBlocks: c.captureOptions.text ? textBlocks : [],
    links: c.captureOptions.links ? links : [],
    images: c.captureOptions.images ? images : [],
  };
  if (new TextEncoder().encode(canonical(result)).length > LIMIT)
    throw Error("SNAPSHOT_TOO_LARGE");
  if (
    !c.allowEmpty &&
    !result.textBlocks.length &&
    !result.links.length &&
    !result.images.length
  )
    throw Error("EMPTY_CONTENT");
  return result;
}

export const errorMessages: Record<string, string> = {
  PERMISSION_REQUIRED: "來源授權已撤銷，請重新授權。",
  SELECTOR_MISSING: "找不到選取區域，請重新選區。",
  SELECTOR_AMBIGUOUS: "選取器符合多個區域，請縮小選取範圍。",
  EMPTY_CONTENT: "內容為空；請調整延遲、區域或明確允許空內容。",
  UNSTABLE_CONTENT: "內容持續變動；請忽略倒數等區域或調整延遲。",
  LOGIN_OR_ERROR_DETECTED: "命中您設定的錯誤／登入 selector，請手動處理。",
  REDIRECTED_ORIGIN: "網站導向其他來源，已停止；請編輯任務網址。",
  SNAPSHOT_TOO_LARGE: "區域超過 20,000 節點或 256 KiB，請縮小範圍。",
  STORAGE_FULL: "儲存空間不足，基準未更新；請先清理資料。",
  LOAD_TIMEOUT: "載入或取樣逾時，將依退避時間重試。",
  WORKER_INTERRUPTED: "工作被中斷，已保留基準並安排重試。",
  INVALID_SELECTOR: "CSS selector 語法無效，請編輯設定。",
};
