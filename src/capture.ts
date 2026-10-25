import { extract, canonical, type Config } from "./core";
declare global {
  interface Window {
    __domWatchRuns?: Set<string>;
    __domWatchOwnedRuns?: Set<string>;
  }
}
// Launched in the isolated main frame. The final message is its own worker event.
export function startCapture(
  c: Config,
  runId: string,
  monitorId: string,
  configVersion: number,
  deadlineAt: number,
) {
  const runs = (window.__domWatchRuns ??= new Set());
  (window.__domWatchOwnedRuns ??= new Set()).add(runId);
  if (runs.has(runId)) return;
  runs.add(runId);
  void (async () => {
    let previous = "",
      count = 0,
      first = 0;
    let code = "UNSTABLE_CONTENT";
    try {
      await new Promise((r) => setTimeout(r, c.settleDelayMs));
      while (Date.now() < deadlineAt) {
        try {
          const content = extract(document, c),
            value = canonical(content);
          if (value === previous) count++;
          else {
            previous = value;
            count = 1;
            first = Date.now();
          }
          if (count >= 3 && Date.now() - first >= 2000) {
            await chrome.runtime.sendMessage({
              type: "CAPTURE_RESULT",
              runId,
              monitorId,
              configVersion,
              content,
              finalUrl: location.href,
            });
            return;
          }
          code = "UNSTABLE_CONTENT";
        } catch (e) {
          code = (e as Error).message;
          previous = "";
          count = 0;
          if (!["NOT_READY", "SELECTOR_MISSING"].includes(code)) throw e;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw Error(code === "NOT_READY" ? "LOAD_TIMEOUT" : code);
    } catch (e) {
      await chrome.runtime
        .sendMessage({
          type: "CAPTURE_ERROR",
          runId,
          monitorId,
          configVersion,
          code: (e as Error).message,
        })
        .catch(() => {});
    } finally {
      runs.delete(runId);
    }
  })();
}
// This bundled file receives commands over tabs.sendMessage after injection.
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
        message.deadlineAt,
      );
      reply({ ok: true });
    }
    if (message.type === "PROBE")
      reply({ runIds: [...(window.__domWatchOwnedRuns || [])] });
    if (message.type === "PREVIEW") {
      try {
        const started = performance.now();
        const content = extract(document, message.config);
        reply({
          ok: true,
          content,
          durationMs: performance.now() - started,
          byteLength: new TextEncoder().encode(canonical(content)).length,
        });
      } catch (e) {
        reply({ ok: false, error: (e as Error).message });
      }
    }
  });
}
