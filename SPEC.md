# Chrome 背景 DOM 區域監控擴充功能：Codex 實作需求規格

版本：1.0｜日期：2026-10-25｜語言：繁體中文｜文件狀態：可直接實作

## 1. 產品目標與已定案範圍

製作 Chrome Manifest V3 擴充功能，讓使用者在網頁上選取一個 DOM 區域，定期在背景分頁重新載入並讀取內容。有變更時保留前後內容、發出桌面通知，並自動採用新內容作為下一次基準。使用者可繼續瀏覽其他分頁，檢查過程不得切換焦點。

「前後對照」是正規化 DOM 內容的文字、連結與圖片網址差異，不是網頁截圖，也不保留原網站完整排版。「自動更新」在成功保存變更紀錄後立即進行，不等待使用者閱讀或確認；通知失敗也不回退基準。

第一版必須完成：新增／編輯／暫停／恢復／刪除任務、視覺化點選區域、忽略子區域、排程、立即檢查、變更歷史、桌面通知、錯誤恢復與本機資料管理。通用 HTTP(S) 網站為目標，不使用 Shopify API 或網站專屬商品解析。

不納入：像素比對、背景截圖、Playwright 執行架構、後端、雲端同步、手機通知、電子郵件、Webhook、繞過 CAPTCHA、跨頁爬取、結帳或自動購買。自動化瀏覽器僅可用於開發測試。

## 2. 技術與交付要求

- TypeScript、Manifest V3、Chrome 桌面版，`minimum_chrome_version` 設為 `120`。交付時另在當時穩定版驗證，記錄實際版本與作業系統。
- 使用本機打包工具；所有執行碼與差異演算法隨套件附帶，不從 CDN 載入程式，不使用 eval、遠端程式碼或分析追蹤。
- UI 框架可由實作者選擇；核心正規化與比較函式不得依賴 UI 框架。
- 提供原始碼、鎖定依賴檔、建置／測試指令、可載入的 unpacked 成品、繁體中文 README、權限說明、限制與人工驗收紀錄。
- 開發載入：Chrome 擴充功能頁面 → 開發人員模式 → 載入未封裝項目。上架商店不是本案交付條件。

## 3. 架構與責任

```text
Popup → 任務列表／新增入口 → 擴充功能管理頁
                               ↓ typed message
Service Worker：排程、權限、分頁、工作狀態、驗證訊息、通知
     ↓ scripting.executeScript（ISOLATED，僅主 frame）
Content Script：區域點選／DOM 擷取／穩定性取樣
     ↓ 序列化資料
正規化與 Diff Engine → IndexedDB 交易 → 通知 outbox
                               ↓
管理頁：狀態、前後對照、紀錄、資料管理
```

建議模組：`background/scheduler`、`background/jobs`、`background/tabs`、`background/notifications`、`content/picker`、`content/extractor`、`core/normalize`、`core/diff`、`storage/repository`、`ui/popup`、`ui/dashboard`、`shared/messages`。

Service Worker 不可依靠全域變數、長時間 setInterval 或 popup 存活維持監控。所有待恢復工作寫入 IndexedDB；事件監聽器在 worker 頂層同步註冊。IndexedDB 為任務與工作狀態唯一真實來源；chrome.storage.local 只存小型 UI 偏好，不建立雙份任務狀態。[官方生命週期說明](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

## 4. 權限設計

Manifest 草案（名稱、版本與圖示路徑由實作補齊）：

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "120",
  "permissions": ["storage", "alarms", "scripting", "notifications", "activeTab"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "background": {"service_worker": "background.js", "type": "module"},
  "action": {"default_popup": "popup.html"}
}
```

| 權限 | 用途與邊界 |
|---|---|
| storage | 偏好設定；大量內容存 IndexedDB |
| alarms | 喚醒排程，不承諾精準時間 |
| scripting | 對已授權來源注入選取／擷取程式 |
| notifications | 建立桌面通知及處理點擊 |
| activeTab | 使用者點擊擴充功能後，在目前頁面啟動選取 |
| optional_host_permissions | 儲存任務時，透過明確使用者手勢要求該來源的持續存取 |

不預先要求 `<all_urls>`、cookies、debugger、webRequest、tabCapture、offscreen、unlimitedStorage 或 tabs 權限。操作分頁不代表必須宣告 tabs；敏感 URL 資訊以該來源 host permission 取得。若實作證明需要額外權限，先在設計與 README 說明具體 API／用途，不可靜默擴權。[Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)

新增任務在「授權並儲存」按鈕直接呼叫 permissions.request，要求如 `https://shop.example.com/*`。不得在非使用者手勢背景自動彈權限視窗。activeTab 是暫時授權，不能作為持續背景監控的依據。來源授權涵蓋該來源路徑，不可宣稱只授權選取區域。[activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)、[Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)

每次檢查前重新確認授權。撤銷權限立即停止該來源檢查，顯示「需要重新授權」。跨來源重新導向不自動要求或擴張授權，即使另一來源先前獲准也先報「網址已重新導向」，交由使用者編輯任務。

## 5. 使用流程與 UX

### 5.1 新增及選取

1. 使用者開啟目標頁面，點擊 popup 的「監控目前頁面」。亦可在管理頁輸入 URL，開啟設定分頁後手動選取。
2. 顯示說明：「比較文字、連結及圖片網址；不比對截圖」。以可移除 overlay 高亮滑鼠指向元素。
3. 點擊選取元素；提供選取父元素／子元素、確認、取消，Esc 取消。攔截該次點擊以免觸發連結。overlay 不可進入快照。
4. 顯示區域文字預覽、圖片網址數與選取器。只能確認主文件中恰好一個匹配的元素。提供進階 CSS selector 編輯及即時驗證。
5. 可點選區域內子元素加入「忽略區域」；忽略 selector 相對於根元素計算。預覽須立即反映忽略結果。
6. 設定名稱、間隔、延遲、文字／連結／圖片網址三項開關；預設三項皆開，至少開一項。授權後用專用背景分頁取得第一份有效基準，成功才標示「監控中」。
7. 新建基準不發變更通知、不新增變更事件。設定頁預覽只是草稿，不當作正式基準。

CSS selector 優先使用唯一且非疑似隨機的 id、穩定屬性，再使用語意 class 與父子路徑；以 CSS.escape 處理值，nth-of-type 僅作最後手段並提示脆弱性。不自行改選其他區域；失配必須報錯。第一版每任務一個根區域；同網址可以建立多個不同任務。

### 5.2 管理頁與 popup

- popup 顯示監控中／錯誤／未讀變更數及管理頁入口；關閉 popup 不影響排程。
- 列表顯示名稱、來源、狀態、最近嘗試／成功／變更時間、預計下次時間、連續錯誤數。
- 每任務支援立即檢查、暫停、恢復、編輯、開啟網站、查看歷史、重新設定基準、刪除。
- 立即檢查仍受併發與同任務鎖限制；執行中顯示「檢查中」，不可重複排入。
- 暫停取消尚未執行工作；執行中的回傳以版本／狀態檢查丟棄。恢復排入一次檢查，沿用基準，不補跑每一個錯過間隔。
- 編輯名稱、通知與間隔不重設基準；編輯 URL、selector、忽略區域、擷取選項時先預覽，明示「將建立新基準」。確認後提高 configVersion、取消舊工作並重建基準，不將新舊規則差異當成網站變更。
- 所有控制可用鍵盤操作；焦點清楚、狀態不只靠顏色，表單有標籤與錯誤說明。

### 5.3 變更與通知

- 歷史事件顯示擷取時間、網站、規則版本；左右兩欄呈現舊／新內容，小螢幕改上下排列。
- 文字以行為單位 diff，標示新增／刪除／未變；行內字詞高亮可列第二階段。連結及圖片網址以有序項目呈現差異，順序改變也算變更。
- 不重新抓取歷史圖片來冒充過去畫面；第一版顯示圖片 URL／alt，無歷史縮圖。文字採安全文字節點輸出，禁止直接渲染原始 innerHTML。
- 預設通知「任務名稱：偵測到內容變更」，不包含敏感內容；點擊後開啟對應事件。事件若已清除，開任務歷史並說明。
- OS 勿擾或通知遭停用時，仍保留歷史、未讀數與狀態提示。通知 API 成功只代表已提交，不能宣稱使用者看見。
- A→B 通知一次；下次仍 B 不通知；B→A 是新事件，須通知。不得用「歷史出現過的 hash」永久去重。

## 6. 排程與專用分頁

產品預設：每 5 分鐘；UI 可選 1、5、10、30、60 分鐘及自訂 1–1440 整數分鐘。每任務最多一個工作，全部任務同時最多兩個；同來源一次一個。第一版最多 20 個任務。

使用一個每分鐘 dispatcher alarm，依 nextDueAt 選取到期任務；開啟瀏覽器、安裝／更新與每次 worker 啟動時冪等確認 alarm 存在。Chrome 120 起 alarm 最短 30 秒，但可能延後；本產品選擇最短 1 分鐘，不宣稱準時觸發。[Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)

每次正常檢查完成後，nextDueAt = 完成時間 + interval。積壓任務依最早到期順序排入，恢復後每任務只跑一次，禁止補跑風暴。佇列等待也要顯示於 UI。

每個執行工作建立 `active:false` 的專用背景分頁，使用一般 profile 的登入情境；不重新整理使用者原本開啟的分頁。檢查完成後關閉自己的分頁。背景分頁仍會出現在分頁列、消耗資源，不是隱形瀏覽器。每次固定開啟儲存的 URL，移除 URL fragment；不接受含帳密的 URL。

若使用者將工作分頁切成作用中或自行導覽，立即取消該工作、放棄分頁所有權並保留分頁，不關閉、不拉回背景；之後由排程另開新分頁。若使用者關閉則取消當次工作。只有驗證屬於本工作且未被接管的分頁可以自動關閉。Chrome 重啟後 tabId 不可靠，不得只依舊 tabId 關閉任何分頁；無法證明所有權時保留並在 UI 提示可能殘留分頁。

## 7. 單次檢查與穩定性判定

工作流程：queued → opening → loading → sampling → comparing → committed → finished；錯誤進 failed，設定／暫停衝突進 cancelled。任務的 enabled 與 health 分開儲存，不把暫時錯誤當成使用者暫停。

1. 在 IndexedDB 交易取得任務 lease，寫入 runId、configVersion、startedAt、deadlineAt、phase；lease 120 秒。
2. 開啟專用分頁，等待主文件 complete，再注入 isolated content script。導覽、tabId、frameId、最終 URL、runId 皆需核對。
3. 預設載入後延遲 2 秒，可設 0–30 秒。每秒擷取一次，至少連續三次正規化內容相同，且首末取樣間隔至少 2 秒，才視為穩定。觀察範圍限根區域；忽略區域變動不影響判定。
4. 不依賴 network idle；以實際時間檢查 timeout。單次最長 60 秒，從工作開始計算；不穩定、載入未完成或 selector 不存在皆失敗，禁止把最後一份不穩定內容寫成基準。
5. 可選「就緒 selector」：匹配至少一個才開始穩定取樣；可選「錯誤／登入 selector」：一旦匹配即中止。這是使用者設定，不自稱能辨識所有登入頁或錯誤頁。
6. 確認快照非空、未超上限、設定版本與任務狀態仍一致；再執行比較及交易提交。
7. 以事件式 completion message 與持久工作狀態交接，不把一個跨分鐘 promise 當唯一工作狀態。worker 中途終止後，重新讀取工作、對有效分頁重連；逾 deadline 或 lease 過期則記錄中斷並安全重試。dispatcher 負責最終逾時清理，UI 可在 alarm 延後期間顯示逾時待清理。

## 8. DOM 快照、正規化與判定規則

不得直接比較 innerHTML。每份快照是下列三個有序陣列組成的 canonical JSON，帶 normalizationVersion；用 UTF-8 canonical bytes 計算 SHA-256，再以內容確認差異。

- `textBlocks`：依 DOM 順序擷取區塊文字，以固定區塊元素集合分行；文字節點 Unicode NFC、CRLF→LF、行內空白折疊、去除首尾空白與空行。區塊集合及算法寫入測試，不隨瀏覽器 innerText 行為漂移。
- `links`：依 DOM 順序保留 `{href, text}`，保留重複項；相對 URL 以 document.baseURI 解析為絕對網址，預設保留 query 與 fragment。
- `images`：依 DOM 順序保留 `{src, alt}`；以 currentSrc 優先，否則 src，解析相對網址。記錄當下載入結果，不能保證 lazy-load 圖片已載入。

自動排除 script、style、noscript、template、表單輸入值、擴充功能 overlay，以及透過 hidden、aria-hidden=true、display:none、visibility:hidden/collapse 隱藏的子樹。不因元素在 viewport 外就排除；opacity:0 不視為必然隱藏。排除規則在預覽說明，避免「DOM 內容」被誤解為逐像素可見性。

不保存其他任意屬性、class、style、data-*、事件處理器或完整 HTML。文字內的價格／時間／庫存數預設保留；使用者須透過忽略區域排除倒數或廣告。第一版不提供任意 JavaScript 正規化、正則忽略或自動刪 query 功能。

純文字模式只比較 textBlocks；勾選連結／圖片才將對應陣列納入 hash。開關狀態與版本必須隨快照保存。空快照預設判為 EMPTY_CONTENT；可明確勾選「允許空內容」後將三個有效但空的陣列當作內容，selector 不存在仍屬錯誤。

判定門檻固定為「正規化後任一已選內容不同」。不提供無定義的 5% 視覺相似度。若後續新增敏感度，另訂明分母、演算法與驗收，不沿用像素差異百分比。

上限：每份 canonical JSON UTF-8 256 KiB、遍歷最多 20,000 個節點；超過即 SNAPSHOT_TOO_LARGE，要求縮小區域。禁止截斷後靜默當成功。

## 9. 資料模型與交易

所有 ID 使用 UUID；時間存 UTC epoch milliseconds，UI 依使用者時區顯示。schemaVersion 與 normalizationVersion 獨立管理。

| Store／實體 | 必要欄位 |
|---|---|
| monitors | id, name, url, origin, selector, ignoreSelectors[], captureOptions, readinessSelector?, failureSelector?, allowEmpty, intervalMinutes, settleDelayMs, enabled, health, configVersion, baselineSnapshotId?, nextDueAt, lastAttemptAt?, lastSuccessAt?, lastChangeAt?, consecutiveFailures, lastError?, createdAt, updatedAt |
| snapshots | id, monitorId, runId, configVersion, normalizationVersion, capturedAt, finalUrl, textBlocks[], links[], images[], hash, byteLength |
| changeEvents | id, monitorId, runId, configVersion, beforeSnapshotId, afterSnapshotId, detectedAt, summary, readAt? |
| jobs | runId, monitorId, configVersion, phase, tabId?, documentId?, startedAt, deadlineAt, leaseUntil, attempt, error? |
| notificationOutbox | eventId（唯一鍵）, notificationId, state(pending/sent/failed), attempts, lastError?, updatedAt |
| settings | schemaVersion, notificationsEnabled, retentionDays, maxEventsPerMonitor, uiPreferences |

`captureOptions` = `{text:boolean, links:boolean, images:boolean}`。`lastError` = `{code, userMessage, occurredAt, retryAt?, diagnosticId}`。health 至少包含 initializing／healthy／retrying／needs_permission／needs_attention；enabled=false 另顯示暫停。

比較成功無變化：只更新成功時間、健康狀態與排程，不重複保存相同快照。第一次成功：建立快照並指向基準，不產生事件。

有變化時，以同一 IndexedDB readwrite transaction 驗證 runId、configVersion、lease、舊 baselineSnapshotId，寫新快照、事件、outbox，再更新 baseline 與時間。以 runId 唯一約束防止重送完成訊息重複提交。交易失敗必須全部回滾，舊基準保留。通知只在交易完成後處理。

通知使用固定 eventId 衍生 notificationId，重試更新相同通知 ID。API 與資料庫之間無原子交易，故只承諾事件恰一次、通知盡力去重；worker 在通知成功與標記 sent 之間中斷時，仍可能再次提示。同一事件最多重試三次，與內容檢查排程分離。

資料預設只保留最近 30 天且每任務最多 50 筆事件，先到上限先清理；保留被基準或未刪事件引用的快照。全資料軟上限 50 MiB，達上限先刪最舊歷史及無引用快照；仍無法容納新完整事件則報 STORAGE_FULL，禁止推進基準。配額依瀏覽器／磁碟狀況而異，50 MiB 不是保證可用容量。

提供單任務刪除及「清除所有本機資料」確認。刪除先取消工作，再刪關聯事件／快照／outbox；遲到訊息不得復活任務。支援匯出／匯入設定 JSON（不含歷史或登入資料），匯入須驗 schema、URL、上限，列預覽、重新授權並建立新基準。升級 migration 需交易與失敗回復，不能以刪除資料代替遷移。

## 10. 訊息、隱私與安全

- 定義具 discriminated union 的訊息：START_PICKER、PREVIEW_SELECTION、CREATE_MONITOR、UPDATE_MONITOR、RUN_NOW、PAUSE_MONITOR、RESUME_MONITOR、DELETE_MONITOR、CAPTURE_RESULT、CAPTURE_ERROR、MARK_EVENT_READ。
- UI 只向背景要求操作；content script 只提供擷取結果，不可自行指定基準、任務狀態或通知內容。所有輸入做 runtime schema validation。
- 背景驗證 sender.id、tab.id、主 frame、documentId／本次導覽識別、runId、monitorId、configVersion 與字節上限；不接受頁面 postMessage 直接建立任務。不要宣告 externally_connectable。
- 網頁內容與匯入檔一律視為不可信資料。以 textContent 顯示，不執行頁面指令或注入式內容。開啟歷史連結前限制 HTTP(S)，新分頁採安全 opener 設定。
- 第一版不抓取遠端歷史圖片，不傳送 DOM 至外部；無遙測、無 cookies 讀取、無帳密收集。正常頁面請求仍由該網站接收。
- 本機資料未加密，可能含價格、私人頁面內容或 URL 參數；首次設定與資料頁清楚說明。log 不寫 DOM 正文、完整 query、密碼或 token，只存診斷代碼與必要時間。
- chrome.storage.local 設為僅 trusted contexts 可存取；content script 經受控訊息取得必要設定，不可讀取整份任務／歷史。IndexedDB 由擴充功能來源存取。[Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)

## 11. 錯誤與恢復矩陣

| 代碼／情況 | 行為 | 基準／通知 |
|---|---|---|
| PERMISSION_REQUIRED | health=needs_permission，停止自動嘗試，提供授權按鈕 | 保留基準，不報內容變更 |
| UNSUPPORTED_URL | 拒絕建立或要求編輯 | 不建立基準 |
| LOAD_TIMEOUT／OFFLINE／WORKER_INTERRUPTED | 自動退避重試 | 保留基準 |
| SELECTOR_MISSING／SELECTOR_AMBIGUOUS | 顯示重新選區入口；連續三次後 needs_attention，停止自動檢查 | 不以空值覆蓋 |
| UNSTABLE_CONTENT／EMPTY_CONTENT | 顯示調整延遲／忽略區域建議；連三次 needs_attention | 不提交快照 |
| LOGIN_OR_ERROR_DETECTED | 僅依使用者 failureSelector 命中判斷，等待手動處理 | 保留基準 |
| REDIRECTED_ORIGIN | 停止，顯示原來源與新來源，等待編輯 | 不自動擴權 |
| SNAPSHOT_TOO_LARGE／STORAGE_FULL | needs_attention；縮小區域／清理資料後手動重試 | 不推進基準 |
| TAB_CLOSED／TAB_TAKEN_OVER | 取消當次，依原間隔再排；不計網站故障次數 | 不通知變更 |
| NOTIFICATION_FAILED／DISABLED | 事件保留，outbox 有限重試，UI 提示 | 基準照常已更新 |
| CONFIG_CHANGED／MONITOR_DELETED | 丟棄舊 run 回傳 | 不寫入 |

暫時錯誤的重試間隔為 `max(原間隔, min(60 分鐘, 1 分鐘 × 2^(連續失敗數−1)))`；成功歸零。連三次錯誤在 UI／badge 顯示，連十次暫時錯誤後 needs_attention，須手動恢復，避免永久失敗反覆載入。相同連續錯誤最多一則錯誤桌面通知，恢復成功後重設去重狀態。

不能靠一般 content script 精準取得所有主文件 HTTP 狀態；不得假裝已可靠辨識 403／404／429。若錯誤頁恰有原 selector 且內容穩定，仍可能被當成內容變更。可用就緒／錯誤 selector 降低風險，UI 與 README 必須明列此限制。

## 12. 明確限制

1. DOM 比較無法發現相同 URL 圖片的位元組被替換、CSS／字型／顏色／版面變更、canvas／影片畫面、偽元素或背景圖片的變化。
2. 第一版僅主文件 light DOM；iframe（包含同來源）及 Shadow DOM 不納入選取與擷取，點選時提供不支援提示。closed shadow root 不能保證讀取。
3. 不支援 chrome://、chrome-extension://、Chrome Web Store 等受限頁面、內建 PDF viewer、file://、無痕模式。只接受一般 profile 的 HTTP(S) HTML 文件。
4. 背景執行不等於瀏覽器關閉仍工作；Chrome 結束、擴充功能停用、裝置睡眠或離線會中斷。恢復後只跑一次，不保證捕捉中間短暫變化。
5. alarm、背景計時器、分頁節流／凍結／捨棄可能延遲檢查；穩定性取樣的「每秒」是目標，不是即時保證。
6. 沿用同 profile 的一般登入情境，但登入逾時、第三方 cookie／儲存分割、網站風控可能造成不同結果；不保證所有登入頁可監控，也不保證不被視為自動化。
7. 背景頁可能不執行與前景相同的載入邏輯；lazy loading、無限捲動與虛擬列表僅擷取當下已存在的 DOM。不自動捲動、不保證包含整個商品目錄。
8. DOM 結構或 selector 改變可能停止監控；個人化、A/B 測試、廣告與價格倒數可能造成有效但不關心的變更。
9. 每次只比較相鄰成功快照；檢查間隔內 A→B→A 可能完全看不見。通知不是商品上架時間的精準證明。
10. OS 決定通知顯示方式；沒有聲音、常駐時間、必達或跨裝置通知保證。[Notifications API](https://developer.chrome.com/docs/extensions/reference/api/notifications)

## 13. 驗收標準與測試資料

建立可控制的本機 HTTP 測試網站，含商品列表、延遲載入、倒數、登入替代頁與大型區域。不得只依賴會變動的真實商店。開發測試可縮短內部時間，但需另用正式最短 1 分鐘設定驗證排程。

| ID | 情境與操作 | 可驗證結果 |
|---|---|---|
| AC01 | 新增列表區域並授權 | 成功建立正式基準，無變更事件／通知 |
| AC02 | 操作另一分頁，背景跑兩輪 | 作用中分頁與視窗焦點不變；原頁不被重新整理 |
| AC03 | A→B，接著保持 B | 只有一筆前後事件；基準為 B，無重複內容通知 |
| AC04 | B→A | 形成第二筆事件，完整保留各次 before／after |
| AC05 | 改文字／價格、連結 href、圖片 URL、列表順序 | 各已勾選項都能偵測；未勾選項不參與判定 |
| AC06 | 改空白／非採集屬性／忽略倒數 | 正規化內容不變，無事件 |
| AC07 | 同 URL 換圖片 bytes；只改 CSS | 不報變更，文件說明此預期限制 |
| AC08 | 延遲載入及持續抖動 | 穩定後才提交；60 秒不穩定則錯誤並保留基準 |
| AC09 | selector 無匹配／兩個匹配／空內容 | 各顯示明確錯誤；不得把其他區域當目標 |
| AC10 | 撤權限與跨來源 redirect | 停止擷取，無額外授權彈窗，無基準污染 |
| AC11 | 暫停／編輯／刪除時舊 run 完成 | 舊回傳被丟棄；刪除後資料不復活 |
| AC12 | 停止 worker，重新喚醒／重啟 Chrome | 任務與基準保留；alarm 重建；過期工作恢復或退避，無重複事件 |
| AC13 | 同時觸發 alarm 與立即檢查 | 同任務只跑一次；全域最多兩個，同來源最多一個 |
| AC14 | 強制交易失敗／磁碟配額錯誤 | 事件與基準皆不部分寫入，可安全重試 |
| AC15 | 通知失敗、重送 completion、提交後 worker 中斷 | 事件恰一次、基準正確；通知遵守固定 ID 與有限重試 |
| AC16 | 關閉或接管背景工作分頁 | 取消當次；不關閉接管分頁，不搶焦點 |
| AC17 | 歷史文字含 HTML／script、惡意匯入 JSON | 當文字顯示或拒絕輸入，不執行程式、不擴權 |
| AC18 | 超大區域／20 任務／第 21 任務 | 超限明確拒絕；既有基準及正常任務不受污染 |
| AC19 | 清理保留期限與全部資料 | 保留當前基準及仍被引用快照；全部清除後無任務、工作或歷史 |
| AC20 | 睡眠後恢復，通知被 OS 關閉 | 不補跑風暴；顯示實際檢查時間與通知狀態 |

測試層級：核心單元測試涵蓋 canonicalization、相鄰 hash 判定、有序 diff、退避與 migration；整合測試涵蓋 IndexedDB 原子提交、lease、版本衝突與 outbox；載入擴充功能後人工驗證選取、權限提示、通知點擊、焦點、重啟與 OS 行為。以測試網站 5,000 節點／不超過 256 KiB 快照驗證擷取與 diff 可完成，記錄測試機、耗時及版本，不把單機數字當全平台 SLA。

## 14. 實作里程碑與完成定義

| 階段 | 交付與退出條件 |
|---|---|
| M1：骨架與持久化 | 可建置載入、權限按需授予、typed messages、IndexedDB schema／migration；讀寫與拒權測試通過 |
| M2：選取與快照 | overlay、唯一 selector、忽略區域、預覽、canonicalization、基準建立；AC01／05／06／09／17 通過 |
| M3：背景工作 | dispatcher、併發、lease、分頁所有權、穩定取樣、錯誤退避與恢復；AC02／08／10／11／12／13／16／20 通過 |
| M4：變更與介面 | 原子事件與基準更新、diff 歷史、通知 outbox、未讀狀態；AC03／04／14／15 通過 |
| M5：交付與驗收 | 設定匯入匯出、清理、上限、無障礙基本操作、完整 README、限制、全部 AC 實測紀錄與成品 |

完成定義：所有 P0 功能（本文件「必須」與第一版流程）完成；全部 AC 通過或附上可重現的 Chrome／OS 限制證據與明確使用者提示，不得把未完成項默認視為限制。建置與測試可從乾淨環境重現；無未處理 promise rejection；不要求額外後端；所有資料留本機；README 清楚區分 DOM 差異與像素差異。

## 15. 給 Codex 的執行指示

依本文件逐階段實作，不再詢問已定案的背景監控／前後對照／自動更新選項。框架、目錄命名與一般 UI 細節可自行決定。先完成可載入的端到端流程，再補足工作恢復與錯誤案例；不得以純 UI prototype 交付。若 Chrome API 與規格衝突，以當時官方文件和可重現測試為依據，記錄差異並提出最小範圍調整；不可暗自改成截圖、網站 API、遠端服務或手動確認基準。

## 16. 官方參考與核對註記

本文件的產品預設、資料上限、重試策略與驗收條件為本案設計決策；下列文件用於 API 行為核對，核對日為 2026-10-25。實作者交付時應重新核對，不依賴新版本專用 alarm 持久化旗標；以重建排程支援最低 Chrome 120。

- [Alarms API：排程、延遲與重啟注意事項](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Service Worker 生命週期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Scripting API：注入與授權](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [activeTab：暫時授權](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Tabs API：分頁管理與權限](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Storage API：儲存與存取層級](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Notifications API：通知與事件](https://developer.chrome.com/docs/extensions/reference/api/notifications)
