# DiffWatch：專案交接與開發手冊

更新日期：2026-10-26。讀者假設：有基本程式／網頁概念，但從未開發 Chrome 擴充功能。

本文件依目前原始碼說明實際行為。完整需求見 [SPEC.md](../SPEC.md)，快速操作見 [README.md](../README.md)，實測與人工驗收缺口見 [ACCEPTANCE.md](../ACCEPTANCE.md)。規格不等於所有功能已驗收通過。建置、權限與限制的集中參考見 [DEVELOPMENT.md](DEVELOPMENT.md)。

專案名稱為 DiffWatch；為保留現有 Chrome 資料與相容性，IndexedDB 名稱 dom-watch、內部訊息／overlay 標記及目前載入資料夾仍沿用原識別，不因品牌更名清庫或搬移載入位置。

## 1. 產品與目前範圍

使用者在網站選一個 DOM 區域，系統定期另開背景分頁，讀取文字、連結與圖片網址，與上次成功基準比較。有變更便保存前後快照、產生事件、立即更新基準，再提交桌面通知。

第一次 A 只建基準；之後 B 保存 A→B；仍 B 不新增；回 A 保存 B→A。不是跟所有歷史比對，也不是曾出現過就永遠不通知。

原本網站、popup、管理頁都可關閉；Chrome／裝置必須仍可執行。每次檢查另建 active:false 專用分頁，完成後關閉，不重新整理使用者原分頁。

已實作新增／編輯／暫停／恢復／刪除、選區與忽略、預覽、排程與立即檢查、歷史 diff、單筆／全部已讀、桌面通知、設定匯入匯出與資料清理。

**電子郵件尚未實作。** 曾討論的每任務收件者、信中 diff／網站連結目前沒有對應服務、憑證設定、郵件 outbox 或後端。沒有像素比較、背景截圖、雲端同步、網站專用 API、CAPTCHA 繞過或自動購買。

## 2. Chrome 擴充功能的四個執行位置

| 位置           | 責任                                   | 入口                   |
| -------------- | -------------------------------------- | ---------------------- |
| Popup          | 點工具列圖示的小視窗，摘要與入口       | popup.html → ui.js     |
| 管理頁         | 任務、表單、歷史、資料管理             | dashboard.html → ui.js |
| Service worker | 無畫面，處理排程、權限、分頁、DB、通知 | background.js          |
| Content script | 在目標網站讀 DOM、顯示選區、取樣       | picker.js、capture.js  |

幾個基本名詞：

- Manifest V3：擴充功能設定格式與執行模型；manifest.json 宣告入口、版本與權限。
- DOM：瀏覽器解析 HTML 的節點樹；CSS selector 例如 #products 用來選節點。
- Service worker：事件喚醒，Chrome 可停止它；不可用記憶體變數當永久任務資料。
- Isolated world：content script 與網站腳本分開的 JavaScript 環境，共用 DOM、不共用一般全域變數。
- Main frame：最外層文件；本專案不注入 iframe。
- Origin：協定、主機、連接埠組合；127.0.0.1 與 localhost 是不同來源。
- Extension origin：chrome-extension://某個ID/，與網站來源及資料庫不同。

worker 沒有 Document，不能直接 document.querySelector。它注入網站程式，再經 runtime.sendMessage／tabs.sendMessage 接收序列化結果。跨執行位置不能直接讀另一邊的區域變數。

## 3. 目錄與各檔案用途

目前位置 D:\Dev\Monitor-Compare；換電腦可放其他路徑，產品不靠此固定位置執行。

| 路徑                  | 用途／何時修改                                                         |
| --------------------- | ---------------------------------------------------------------------- |
| src/background.ts     | 背景事件、工作協調、安全驗證、通知；改排程與分頁生命週期看這裡         |
| src/capture.ts        | 網站內穩定取樣、即時預覽、ownership probe                              |
| src/core.ts           | 型別、設定驗證、擷取、正規化、canonical、hash、diff、退避              |
| src/messages.ts       | UI／背景訊息型別與 send 包裝                                           |
| src/picker.ts         | 可視化選區 overlay、selector 生成、忽略子區域                          |
| src/storage.ts        | IndexedDB、原子交易、任務／工作／快照／事件持久化                      |
| src/ui.ts             | popup、管理頁、表單、歷史與資料頁，使用原生 DOM API                    |
| public/style.css      | 樣式源檔；卡片、開關、表單、響應式配置                                 |
| public/icon.png       | 擴充功能與通知圖示                                                     |
| build.mjs             | esbuild 打包、產生 manifest／HTML、複製資源                            |
| package.json          | 開發指令與固定版本依賴                                                 |
| package-lock.json     | 完整依賴鎖定，須一起版本控制                                           |
| tsconfig.json         | TS 檢查設定，不是 Chrome 執行設定                                      |
| tests/core.test.ts    | 核心規則測試，jsdom 提供 DOM                                           |
| tests/storage.test.ts | fake-indexeddb 下交易與持久狀態整合測試                                |
| tests/e2e.mjs         | 真正載入測試擴充功能的瀏覽器測試                                       |
| fixtures/server.mjs   | 可控制版本、延遲、抖動等的本機 HTTP 網站                               |
| doc/HANDOVER.md       | 本交接手冊                                                             |
| README.md             | 快速入門、權限、限制                                                   |
| SPEC.md               | 原始完整需求                                                           |
| ACCEPTANCE.md         | 實測證據與人工待驗項目                                                 |
| history-preview.png   | 歷史畫面示意，不是執行必需                                             |
| .gitignore            | 排除 node_modules、work、log 等                                        |
| node_modules/         | npm 安裝的開發依賴，不提交                                             |
| work/                 | 臨時腳本、測試 profile、副本、截圖；不是正式模組，不保證每個臨時檔存在 |
| dist/                 | 可直接載入 Chrome 的建置結果，目前也追蹤於 Git                         |

### dist 的組成

manifest.json 由 **build.mjs** 產生，宣告最低 Chrome 120、權限與入口。background.js、ui.js 是 ESM bundle；picker.js、capture.js 是自包含 IIFE，注入網站不需要額外 import。

popup.html、dashboard.html 也由 build.mjs 產生；共用 ui.js，依 body 的 data-page 決定畫面。style.css／icon.png 從 public 複製。\*.js.map 是 source map，讓 DevTools 對照 TS 源檔。

**不要只改 dist。** 下次 build 會覆蓋。改 UI 編輯 src／public；改 manifest、HTML 樣板、版本號編輯 build.mjs。

## 4. 第一次執行與開發循環

只用成品：Chrome 開 chrome://extensions → 開發人員模式 → 載入未封裝項目 → 選 **dist**，不是專案根目錄。在一般 HTTP(S) HTML 網站選區，進表單先驗證預覽再儲存；正式基準由背景分頁重新擷取，預覽不是基準。

開發安裝 Node.js 22 以上與 npm；原環境 Node 24.14.1／npm 11.11.0。

```powershell
cd D:\Dev\Monitor-Compare
npm ci
npm run typecheck
npm test
npm run build
```

| 指令              | 作用                                                      |
| ----------------- | --------------------------------------------------------- |
| npm ci            | 依 lockfile 安裝，不要為安裝問題直接刪 lockfile／全套升級 |
| npm run typecheck | tsc 檢查，不產出 JS                                       |
| npm test          | tsx 執行 tests/\*.test.ts，不包含 e2e.mjs                 |
| npm run build     | 打包並產出 dist                                           |
| npm run fixture   | 啟動本機網站，Ctrl+C 停止                                 |
| npm run test:e2e  | 自動啟動測試網站與獨立測試瀏覽器                          |
| npm run format    | Prettier 排版，不是測試／建置                             |

依賴皆為開發用途：esbuild 打包、typescript／@types 型別、tsx 跑 TS、jsdom 模擬 DOM、fake-indexeddb 模擬 DB、playwright 瀏覽器測試、prettier 排版。使用者載入 dist 不需 Node／Playwright，也沒有遠端服務依賴。

日常流程：修改源檔 → 檢查／必要測試 → build → 擴充功能頁按重新載入 → 刷新管理頁。改 content script 時也刷新測試網站，避免舊注入程式留在原文件。Chrome 不直接執行 TS，目前沒有 watch／熱更新指令。

## 5. core.ts：共用規則

定義 Config、Monitor、Content、Snapshot、Job、ChangeEvent、Outbox 型別。核心不依賴 UI 框架，但 extract 需要 DOM，只能在網站／頁面或 jsdom 跑，不能直接在 worker 跑。

| 函式／常數                   | 作用                                                |
| ---------------------------- | --------------------------------------------------- |
| urlOf                        | 驗 HTTP(S)、拒帳密／受限商店、移除監控網址 fragment |
| config                       | runtime 驗設定與匯入資料，產生受控 Config           |
| cleanText                    | Unicode NFC、換行與空白正規化                       |
| extract                      | 根唯一性、排除隱藏／忽略子樹、擷取三種有序內容      |
| canonical                    | 固定欄位順序 JSON，關閉的種類不納入                 |
| digest                       | UTF-8 canonical bytes → SHA-256、byteLength         |
| changed                      | 實際比較 canonical 字串，不只相信 hash              |
| diff                         | 顯示新增／刪除／未變                                |
| backoff                      | 依間隔與連續失敗數算退避                            |
| NORMALIZATION_VERSION／LIMIT | 正規化版本／256 KiB 上限                            |
| errorMessages                | 部分錯誤代碼的繁體中文說明                          |

不比較 innerHTML；文字依固定區塊集合分行，不靠 innerText 排版推導。連結／圖片保留順序與重複，以 document.baseURI 解析 URL；圖片優先 currentSrc。

排除 script/style/noscript/template、輸入值、overlay、hidden、aria-hidden=true、display:none、visibility:hidden/collapse。畫面外不排除，opacity:0 不自動排除。價格／時間仍保留，倒數要由使用者忽略。

最多遍歷 20,000 節點、canonical JSON 256 KiB，超限失敗、不截斷。空內容預設失敗，可明確允許；selector 不存在仍是錯誤。

diff 先保留共同前綴／後綴，中段以 LCS（最長共同子序列）比對；超過 100 萬比較格時整段呈現刪除／新增，限制記憶體。這只影響高亮粒度，完整前後內容與變更判定仍保留。

## 6. storage.ts：唯一真實資料來源

IndexedDB 名稱 dom-watch，目前 DB 版本 1。

| Store              | 主鍵    | 內容                                              |
| ------------------ | ------- | ------------------------------------------------- |
| monitors           | id      | 設定、enabled／health、基準指標、時間／錯誤       |
| snapshots          | id      | 正規化內容、hash、runId、版本／時間               |
| changeEvents       | id      | 前後快照 ID、readAt；runId 有唯一索引             |
| jobs               | runId   | 階段、tabId／documentId、deadline／lease／session |
| notificationOutbox | eventId | 通知 ID、狀態、次數／錯誤                         |
| settings           | key     | global 設定、schemaVersion 等                     |

- openDB／request／transaction：開庫、Promise 包裝、等待整筆交易完成；失敗 abort。
- save：驗設定與最多 20 任務；擷取規則變更提升 configVersion、取消舊工作並重建基準。
- acquire：交易內選到期任務，同任務一、同來源一、全域最多二工作。
- mutate：立即檢查、暫停／恢復、重設基準、刪除。
- fail：分類健康與退避；接管／關閉分頁不計網站故障。
- commit：初次只建基準；無變更不重存；有變更以同交易保存快照、事件、outbox 並更新基準。
- cleanup／prune：清理事件、outbox、無引用快照與舊終態工作。
- claimNotification：交易內取得通知嘗試，避免併行超次數。
- clear：使用者明確清除才清庫並重建預設值，不用來升級。

commit 不能拆成獨立寫入；任一步失敗保留舊基準，重送 runId 不產生第二事件。保留 30 天且每任務最多 50 事件；基準／事件仍引用的快照不能直接刪。50 MiB 是軟上限，不是保證配額。

目前只有 v1 初始 schema，**沒有已完成的多版本 migration 系統**。新增 store／索引要提高版本並依 oldVersion 逐段交易遷移，不能重跑全部 createObjectStore 或刪庫代替。settings 有 retention 欄位，但尚無調整介面，清理仍有 30／50 常數；要可設定必須同步修改。

## 7. background.ts：協調者與安全邊界

頂層註冊 runtime message、安裝／啟動、alarm、分頁更新／切入／移除、來源撤權與通知點擊。

| 函式                        | 責任                                                          |
| --------------------------- | ------------------------------------------------------------- |
| ensureAlarm                 | 冪等確認每分鐘 dispatcher                                     |
| dispatch                    | 恢復／清理工作、取得到期工作、啟動、清理資料與通知            |
| launch                      | 原子 claim queued → opening，查權限，開 active:false 分頁     |
| beginSampling               | 查分頁／來源、注入 capture、保存 documentId、送 CAPTURE_START |
| patchJob                    | 更新非終態工作                                                |
| closeOwned                  | 核對 session、作用中狀態、ownership marker 才關分頁           |
| handle                      | 訊息 runtime 驗證、執行操作                                   |
| uiSender／validContent      | 驗 UI 來源與內容形狀／大小                                    |
| notify／errorNotices／badge | outbox、錯誤通知、未讀／錯誤徽章                              |
| session                     | storage.session 階段識別，記憶體只快取讀取 Promise            |

近期修正的競態：工作已 opening，但 tabs.create 尚未回傳 tabId，另一 dispatcher 可能看到它。不能立刻當 WORKER_INTERRUPTED；由已保存 deadline 清理真正 abandoned 的工作。

## 8. capture.ts 與 picker.ts：網站內程式

capture.startCapture 接 CAPTURE_START，以 runId 防重複，等 settleDelayMs，反覆 extract／canonical。連續三次相同且首尾實際至少兩秒才發 CAPTURE_RESULT；deadline／明確錯誤發 CAPTURE_ERROR，不提交最後一份不穩定結果。

setTimeout 只用於單次取樣，不是排程唯一來源；背景節流可能延遲。完成訊息是獨立事件，可喚醒 worker，不靠原 Promise 常駐。PREVIEW 只擷取一次，PROBE 查 ownership；安裝旗標避免重複 listener。執行中 runs 與 ownership runs 分開，以便完成後／恢復時仍可證明分頁所有權。

picker 的主要操作只有「選取監控區域」與「忽略區塊」兩種模式。忽略模式可連續排除多個子區塊，清單能個別恢復。淡綠色區塊呈現監控預覽，底部「下一步：設定監控」前往任務表單，右上關閉／Esc 取消。CSS 規則、擴大／縮小範圍與恢復全部藏在進階設定；重新啟動會清掉舊 overlay／listener。selector 優先唯一非隨機 id、穩定屬性、語意 class，最後 nth-of-type 路徑，使用 CSS.escape。

位置 selector 較脆弱，失配要報錯，不能偷換目標。工具 UI 自己用了 Shadow DOM，不代表支援網站 Shadow DOM；網站仍只取主文件 light DOM。確認送 PICKED 草稿，不建正式基準。

## 9. messages.ts 與 ui.ts

messages.Message 是依 type 區分的 TS union，send 包 runtime.sendMessage，將 ok:false 轉例外。包含選區／預覽、任務操作、CAPTURE_RESULT／ERROR、單筆／全部已讀、STATE、SETTINGS、CLEAR_ALL。

PICKED、CAPTURE_START、PREVIEW、PROBE 等內部協議目前直接寫在背景／content script，**尚未全部納入 union**。TS 不提供 runtime 安全，背景仍須驗 sender.id、UI URL、tab／主 frame／documentId、run／monitor／configVersion、來源、內容大小。

ui 使用原生 DOM，沒有 React／Vue：

- refresh：要 STATE，非編輯管理頁每五秒刷新；這不是監控排程。
- popup：摘要／入口。
- dashboard：名稱右邊開關、右上編輯、時間分項、右下刪除文字外觀 button。
- form：新增／編輯、授權、網頁／選區藍色區塊、預覽與儲存；返回箭頭在標題旁。
- history：左右／上下 diff、單筆已讀、目前任務全部已讀。
- dataPage：通知開關、設定匯出匯入、清除全部。

開關有 role=switch／aria-checked，圖示有 title／aria-label。網站資料使用 textContent，不可為方便改成 innerHTML。

預覽門檻：previewKey 保存成功驗證設定，updateSave 比當前設定；新增／改擷取規則未驗證、驗證中、儲存中都鎖住。submit 再檢查防 Enter 繞過；驗證途中改設定，舊結果不能解鎖新設定。失敗不能授予資格。

只改既有名稱／通知／間隔依需求不重建基準，因此不用強迫新預覽。requiresBaseline 與 storage.save 的 reset 清單必須一致。

## 10. 一次檢查的流程與關鍵 ID

```text
UI 按鈕 → permissions.request → CREATE_MONITOR
背景驗證 → storage.save → dispatcher → acquire
→ launch → tabs.create(active:false) → 主文件 complete
→ 注入 capture → CAPTURE_START → 穩定取樣 → CAPTURE_RESULT
→ 驗 sender／文件／版本／來源 → commit 同交易
→ outbox → Chrome notification → badge → UI STATE 顯示
```

實際 jobs.phase 主要 queued → opening → loading → sampling → finished，另有 failed／cancelled。SPEC 示意的 comparing／committed 不代表目前逐一保存。

enabled=false 是使用者暫停；health 是 initializing／healthy／retrying／needs_permission／needs_attention，錯誤不等於暫停。

runId 識別工作、configVersion 防舊設定晚到、documentId 識別文件、leaseUntil 限有效期、deadlineAt 限單次時間，不能互換。

成功後 nextDueAt = 完成時間 + 間隔，再由每分鐘 dispatcher 挑選，因此一分鐘設定可能接近兩分鐘，加載入／節流延遲。手動檢查也更新下次時間。只有變更才通知，看最近嘗試／成功判斷有無執行。

切入／導覽工作分頁要取消並放棄所有權。重啟後 tabId 可重用，不能只憑舊 ID 關分頁；不能證明就保留並提示殘留。

先提交事件與基準才通知；通知失敗不回退。outbox 固定 ID、最多三次；API 與 DB 無跨系統原子交易，成功通知但未寫 sent 就中斷仍可能重提示，API 成功不保證 OS 顯示。全部已讀只改該任務未讀、保留既有 readAt，其他任務仍未讀，badge 重算。

## 11. 權限、隱私、資料位置

manifest 只有 storage、alarms、scripting、notifications、activeTab；HTTP(S) 是 optional_host_permissions，不預授權全部網站。沒有 tabs／cookies／debugger／webRequest／offscreen／unlimitedStorage／externally_connectable。

activeTab 是點擊後暫時權限，不代表持續監控。來源授權須在明確按鈕手勢 request，不能 alarm 自動彈窗。授權涵蓋來源路徑，不只區域。每次重查，撤權停；跨來源 redirect 即使另一來源曾授權也先停，交使用者編輯。

大量資料在 extension IndexedDB，不在專案目錄。storage.session 保存階段／草稿，不是第二份任務；storage.local 設 trusted contexts，目前不放大量任務。

搬源碼不會搬 Chrome profile 歷史。未封裝擴充功能換載入位置可能影響 ID，先匯出設定，不承諾歷史一起移轉。匯出不含歷史、登入或來源授權。

資料未加密，可能含私人文字／URL 參數。不要提交 profile、真實 DOM、token、敏感 query 或私人匯出到 Git／公開 log。現有執行碼都本機打包，無 CDN、eval、遙測；正常網站請求仍由網站接收。

## 12. 測試網站與測試分層

npm run fixture 後開 http://127.0.0.1:8765/；根 #products、忽略 .countdown，請求 /set?v=B 改版、/set?v=A 改回。

| query／路徑            | 用途                                                  |
| ---------------------- | ----------------------------------------------------- |
| ?mode=delay            | 五秒後加內容，須配延遲／readiness，避免更早穩定先完成 |
| ?mode=unstable         | 持續改文                                              |
| ?mode=login            | 登入替代，可用 failureSelector=#login                 |
| ?mode=empty／ambiguous | 空／重複根                                            |
| ?mode=large／benchmark | 超節點／5,000 節點                                    |
| /redirect              | 導到 localhost 不同來源                               |

穩定三次只證明觀察期相同，不保證之後不載入。readiness／延遲須依網站設定。

core.test.ts 驗設定／URL、正規化、排除、有序內容、根／空值、hash／相鄰變更、diff／退避、上限與效能。storage.test.ts 驗交易回滾、基準／事件／outbox、防重送、lease／版本、併發、上限與清理；模擬 abort 不代表真磁碟耗盡。

e2e.mjs 驗真正載入的 A→B→B→A、歷史／刪除／跨來源／接管、停止 worker 恢復、選區預覽儲存與門檻、效能。執行：

```powershell
npx playwright install chromium
npm run test:e2e
```

E2E 自開 fixture，先停手動 fixture，避免占 8765。CHROME_EXECUTABLE 可指定支援測試載入的 Chrome for Testing；勿用日常 profile。SCHEDULE_TEST=1 可真正等一分鐘設定兩輪，需數分鐘；不設則一般測試。

測試只對 work/test-extension 副本加 loopback host_permissions，避免 headless 權限提示；dist 仍 optional。因此不能宣稱 E2E 證明真實權限／拒權／OS 通知全通過。

原紀錄 Windows 11 核心 10.0.26100、Chrome for Testing 151.0.7922.34；另見 Chrome 155.0.8059.80，但未完成該版本互動驗收／未確認通道。人工依 ACCEPTANCE.md，單機效能不是 SLA。

## 13. 新手除錯路線

改了沒變：確認改源檔、已 build、Chrome 載正確 dist、已重載擴充功能，再刷新管理頁／網站。網站 F5 不會自動更新 worker bundle。

Console 分三處：管理頁／popup 右鍵檢查看 UI；chrome://extensions 點 service worker 檢查找背景錯誤；網站 DevTools 選擴充功能 isolated context 找 picker／capture。網站自己的 context 不會看見 isolated 全域。

worker Console 可唯讀執行：

```javascript
await chrome.alarms.get("dispatcher");
await chrome.permissions.getAll();
await chrome.notifications.getPermissionLevel();
```

DevTools 可能改 worker 存活，開著正常不等於停止後可恢復。不要輸出真實 DOM／秘密。

沒通知先看時間：嘗試／成功都不更新查 alarm、enabled、needs_permission／needs_attention、佇列；嘗試動成功不動查擷取錯誤；成功動無事件可能沒內容變更；有事件沒通知查 outbox、開關、Chrome／OS 勿擾，不要重設基準假裝修好通知。

YouTube 等動態網站背景載入可能不同，觀看數／留言／lazy load 不保證完整。Chrome 關閉、睡眠、離線會中斷／延後，恢復不補每個錯過間隔。

| 錯誤                        | 優先檢查                                   |
| --------------------------- | ------------------------------------------ |
| PERMISSION_REQUIRED         | 來源是否允許／撤銷，request 是否使用者手勢 |
| SELECTOR_MISSING／AMBIGUOUS | selector、改版、iframe／Shadow DOM         |
| EMPTY_CONTENT               | 未載入、根／選項沒內容                     |
| UNSTABLE_CONTENT            | 倒數／輪播是否應忽略                       |
| LOAD_TIMEOUT                | 網路、節流、readiness                      |
| LOGIN_OR_ERROR_DETECTED     | 使用者 failureSelector，不是識別所有登入頁 |
| REDIRECTED_ORIGIN           | 原／新來源，交使用者編輯                   |
| WORKER_INTERRUPTED          | session／deadline／階段／恢復競態          |
| TAB_TAKEN_OVER／TAB_CLOSED  | 使用者操作，取消不報內容變更               |
| SNAPSHOT_TOO_LARGE          | 縮小區域，不截斷                           |
| STORAGE_FULL                | 清理／配額，保留舊基準                     |

一般 content script 無法精準取得所有主文件 HTTP 狀態，不能宣稱可靠辨識 403／404／429；錯誤頁若仍符合根可能被判為變更。同 URL 換圖片 bytes、CSS／字型／版面、canvas、影片、偽元素與背景圖片不屬本版比較範圍。

## 14. 接新需求時改哪裡

| 改動                 | 位置                                     | 連動事項                                                  |
| -------------------- | ---------------------------------------- | --------------------------------------------------------- |
| 卡片／表單／圖示     | ui、public/style.css                     | aria／鍵盤／小螢幕、build                                 |
| 擷取／正規化         | core、capture、測試                      | normalizationVersion、舊基準相容／重建                    |
| 新設定               | Config／config、form、save               | 匯入匯出、previewKey、requiresBaseline／reset 一致        |
| 新訊息               | messages、handle、呼叫端                 | runtime／sender 驗證、交易                                |
| schema               | openDB、型別、讀寫                       | 版本 migration、回滾、保留舊資料                          |
| 排程／退避           | dispatch／acquire／fail／commit／backoff | 併發、來源鎖、晚到、重啟、無補跑風暴                      |
| 通知／已讀           | background、storage、history             | 固定 ID、有限重試、badge 與其他任務                       |
| manifest／權限／版本 | build.mjs                                | README、最小權限、API 相容性                              |
| 電子郵件             | 需新設計與模組                           | 服務／憑證位置、收件者、diff 隱私、獨立 outbox、migration |

寄信若走外部服務會改變資料留本機邊界，須清楚說哪些 diff／URL 送出。不可寫死 SMTP 密碼／服務端密鑰在可檢視的成品，寄信失敗也不能回退內容基準。

交付前先看 git status／diff，保留其他未提交修改，不 reset 或刪庫清掉不懂的狀態。不提交 node_modules／work／profile／私人資料。源檔與 dist 同步，更新 README／驗收／本文件，未完成／未驗證不可寫成完成。

## 15. 官方延伸閱讀

### 一鍵進入選區（2026-10-25）

表單的網頁設定已合併為「開啟網頁並選取區域」。UI 在明確按鈕手勢要求來源權限，開啟作用中設定分頁，waitForPickerPage 等主文件完成，再送 START_PICKER。遇到關頁、逾時或跨來源導向會報錯，不要求再按第二次選區。原本兩顆按鈕已移除。這是使用者主動設定流程，與監控工作的 active:false 背景分頁不同。

`npm run test:picker` 執行 tests/picker-flow.mjs，以獨立 profile／本機 8766 測試網站驗證載入後自動啟動與跨來源拒絕；與 E2E 一樣僅測試副本預授權 loopback，正式 dist 不變。支援 CHROME_EXECUTABLE 指定測試瀏覽器。

### 歷史管理補充（2026-10-25）

history 頁的「清除歷史紀錄」經確認後送 CLEAR_HISTORY，只清除目前任務。storage.clearHistory 在同一交易刪除事件、對應 outbox 與該任務無引用快照，保留當前基準與其他任務；背景重算 badge。清除不停止進行中的監控，之後有新變更仍會建立新事件。每筆右上角綠字「已讀」／紅字「未讀」，已讀紀錄不再顯示單筆標記按鈕。

本文件描述目前程式，不取代後續 API 版本核對。

- [Manifest](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Worker 生命週期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [Scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [Storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Notifications](https://developer.chrome.com/docs/extensions/reference/api/notifications)
