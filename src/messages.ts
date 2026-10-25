import type { Config, Content } from "./core";
export type Message =
  | { type: "START_PICKER"; tabId?: number; monitorId?: string }
  | { type: "PREVIEW_SELECTION"; tabId: number; config: Config }
  | { type: "CREATE_MONITOR"; config: Config }
  | { type: "UPDATE_MONITOR"; id: string; config: Config }
  | {
      type:
        | "RUN_NOW"
        | "PAUSE_MONITOR"
        | "RESUME_MONITOR"
        | "DELETE_MONITOR"
        | "RESET_BASELINE";
      id: string;
    }
  | {
      type: "CAPTURE_RESULT";
      runId: string;
      monitorId: string;
      configVersion: number;
      content: Content;
      finalUrl: string;
    }
  | {
      type: "CAPTURE_ERROR";
      runId: string;
      monitorId: string;
      configVersion: number;
      code: string;
    }
  | { type: "MARK_EVENT_READ"; id: string }
  | { type: "STATE" }
  | { type: "CLEAR_ALL" }
  | { type: "SETTINGS"; notificationsEnabled: boolean };
export const send = async (message: Message) => {
  const r = await chrome.runtime.sendMessage(message);
  if (!r?.ok) throw Error(r?.error || "背景未回應");
  return r.value;
};
