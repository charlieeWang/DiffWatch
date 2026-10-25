# DOM 區域監控（Chrome Manifest V3）

以專用背景分頁監控選定 DOM 的文字、連結與圖片網址。所有資料留本機。這不是截圖或像素比較工具。

## 載入

首次接手開發者可先讀 [專案交接與開發手冊](doc/HANDOVER.md)，包含擴充功能基礎、逐檔說明、資料流、建置測試與除錯。

`dist/` 已包含可載入成品，不需要先安裝 Node。

1. 開啟 `chrome://extensions`，啟用「開發人員模式」。
2. 點「載入未封裝項目」，選擇 **D:\Dev\Monitor-Compare\dist**。
3. 在一般 HTTP(S) HTML 網頁點擊擴充功能 →「監控目前頁面」。
4. 點選元素，調整父／子元素，必要時點選忽略子區域。也可直接輸入 CSS selector。
5. 確認後，在管理頁設定名稱、間隔及擷取項目，按「授權並驗證預覽」，再按「授權並儲存」。預覽不是基準；背景分頁首次成功擷取後才開始監控。

管理頁可新增、編輯、立即檢查、暫停／恢復、重建基準、刪除、檢視歷史、標記已讀、匯入／匯出設定及清除本機資料。設定頁開啟網站後，也可從網站 popup 啟動選區。授權涵蓋整個來源的路徑，並非只涵蓋選區。

在任務表單按「開啟網頁並選取區域」，授權後會開啟網站並在載入完成時自動啟動選區，不必分兩次操作。

## 建置與測試

使用 Node.js 22 以上及 npm；本次使用 Node 24.14.1、npm 11.11.0。

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

端到端測試使用 Chrome for Testing，僅用於開發測試，不是擴充功能執行依賴：

```powershell
npx playwright install chromium
npm run test:e2e
# 額外使用正式 1 分鐘設定跑兩輪，可能約 2–5 分鐘：
$env:SCHEDULE_TEST = '1'
npm run test:e2e
```

也可用 `CHROME_EXECUTABLE` 指定支援測試載入擴充功能的 Chrome for Testing 執行檔。E2E 自動啟動並停止本機 fixture，8765 連接埠須可用。測試用副本位於 `work/test-extension`，僅測試副本增加 loopback 的 host_permissions，以免無頭模式卡在權限提示；**交付的 dist 不含預授權來源**。因此權限提示與 OS 通知仍需人工驗收，不能把 E2E 通過視為已驗證這些互動。

人工測試網站：

```powershell
npm run fixture
```

開啟 `http://127.0.0.1:8765/`，以 `#products` 選取、`.countdown` 忽略倒數。請求 `/set?v=B` 或 `/set?v=A` 切換版本。`?mode=delay|unstable|login|large|empty|ambiguous|benchmark` 提供延遲、抖動、登入替代、超大、空、重複根元素及 5,000 節點測試。`/redirect` 重新導向到 localhost（不同來源）。

## 架構與資料

- `src/core.ts`：獨立於 UI 的設定驗證、固定區塊正規化、SHA-256、有序差異與退避。
- `src/storage.ts`：IndexedDB schema v1；任務、工作、快照、事件、outbox、設定六個 stores。事件 runId 唯一索引；事件、基準與 outbox 同交易提交。
- `src/background.ts`：頂層註冊事件，每分鐘 dispatcher、最多兩個工作／每來源一個、持久 lease、來源權限、訊息來源與 documentId 驗證、通知。
- `src/capture.ts`：主 frame 的 isolated world 取樣；完成以獨立訊息喚醒 worker。至少三次相同且首尾至少 2 秒；從工作起始最多 60 秒，lease 120 秒。
- `src/picker.ts`：可移除 overlay、唯一 selector、父子選取、忽略子區域及即時預覽。
- `src/ui.ts`：popup／管理頁、前後對照與資料管理；不渲染原始 HTML。

IndexedDB 是任務與工作唯一真實來源；storage.session 只保存瀏覽器 session 識別與選區草稿。worker 記憶體只快取 session 讀取 promise。背景工作不依賴 popup 或跨分鐘 promise。

比較只針對相鄰成功快照：A→B 通知、保持 B 不通知、B→A 再通知。第一次基準不產生事件。內容變更在交易成功後立即更新基準，不等待通知或使用者閱讀。通知以固定 ID 最多嘗試三次；提交與標記之間中斷仍可能重複提示，僅事件承諾恰一次。OS 是否顯示不由 API 成功保證。

每任務最多 50 筆事件且最多 30 天，保留基準與事件引用快照。50 MiB 是軟上限，不是配額保證。交易失敗或內容超限不推進基準。匯出只含設定，不含歷史或登入資料，匯入要重新授權並建立基準。schema v1 的首次建立在版本交易內；後續版本須新增交易 migration，遇到不相容資料不得清庫重建。

文字使用固定區塊集合（見 core.ts 與測試），Unicode NFC、空白折疊，保留價格／時間。連結與圖片保留重複與順序，網址保留 query／fragment。圖片使用 currentSrc 優先。20,000 節點／256 KiB 上限會明確失敗，不截斷。有序 diff 在一般區域使用 LCS；極大型中段編輯超過 100 萬比較格時，將該中段以整段刪除／新增呈現，前後相同段落仍保留。這只影響高亮粒度，不影響是否判定變更與完整前後內容。

## 權限與隱私

| 權限 | 用途 |
| --- | --- |
| storage | UI／草稿與 session 識別；大量內容存 IndexedDB，local 設為 trusted contexts |
| alarms | 每分鐘喚醒排程，啟動時檢查並重建 |
| scripting | 僅主 frame、isolated world 的選區與擷取 |
| notifications | 變更及連續錯誤通知 |
| activeTab | 使用者點擊擴充功能後，暫時在目前頁面選區 |
| optional_host_permissions（HTTP/HTTPS） | 於明確按鈕操作要求該來源持續存取，每次擷取前再次確認 |

未加入 tabs、cookies、debugger、webRequest、tabCapture、offscreen、unlimitedStorage、externally_connectable。所有執行碼本機打包；無 CDN、eval、遙測、後端或外部 DOM 傳送。正常網站請求仍由網站接收。歷史圖片只顯示 URL／alt，不重新下載。

**本機資料未加密**，可能含私人頁面內容、URL 參數。請勿將含個人資料的測試設定或瀏覽器 profile 加入 Git；node_modules、work 與 log 已忽略。

## 已知產品限制

- Chrome 120 以上、一般 profile 的 HTTP(S) HTML；不支援無痕、file、chrome://、擴充功能頁、商店、PDF。
- 僅主文件 light DOM；不支援 iframe、Shadow DOM、canvas、影片、偽元素、背景圖片。
- 相同圖片 URL 換 bytes、CSS／字型／版面改變不算變更。不是網站完整排版或歷史畫面備份。
- 排除 script/style/noscript/template、輸入值、overlay、hidden、aria-hidden=true、display:none、visibility:hidden/collapse。畫面外不排除，opacity:0 不自動排除。
- 登入沿用同 profile；登入逾期、風控、CAPTCHA、個人化可能失敗。不繞過驗證、不自動捲動；lazy-load／虛擬列表只比較當下 DOM。
- 無法可靠取得所有主文件 HTTP 狀態，也不能自動辨認所有錯誤／登入頁。錯誤頁若仍符合選區，可能被判成變更；請設定就緒與錯誤 selector。
- 背景分頁會出現在分頁列並消耗資源。使用者切入或導覽時放棄所有權；不能證明所有權的分頁保留，不依重啟後舊 tabId 自動關閉。
- Chrome 關閉／停用、睡眠、網路或背景節流會中斷或延後；恢復後只檢查一次、不補跑每個錯過間隔。A→B→A 若發生在兩次檢查之間可能看不到。
- 連續三次選區／空／不穩定錯誤、十次暫時錯誤或永久錯誤會停止自動檢查，須人工處理後恢復。一般暫時錯誤按規格退避。

## 驗收狀態

詳細結果、環境、限制及仍待人工操作的項目見 `ACCEPTANCE.md`。自動測試通過不等於所有 AC 完成人工驗收；尤其 stable Chrome 手動載入、權限提示、OS 勿擾、通知點擊、真實視窗焦點、睡眠與 Chrome 重啟仍須在互動桌面確認。

## 官方 API 核對（2026-10-25）

- [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)：以冪等重建方式支援最低 Chrome 120，未使用新版本專用持久化旗標。
- [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)：建立與關閉分頁不需額外 tabs 權限。
- [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications)

原始實作規格保存在 `SPEC.md`。
