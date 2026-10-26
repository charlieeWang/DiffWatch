# 驗收紀錄

日期：2026-10-25（Asia/Taipei）。專案：D:\Dev\Monitor-Compare。

## 環境與執行

- Windows NT 10.0.26100.0（Windows 11 核心版本）；Node 24.14.1、npm 11.11.0。
- 自動化：Playwright 1.62.1、Chrome for Testing 151.0.7922.34、headless、獨立測試 profile。
- 本機另有 Chrome 155.0.8059.80。曾以命令列載入測試：瀏覽器啟動成功，但未出現擴充功能 worker，因此**不能算已完成此版本的擴充功能驗證，也未確認其發行通道**。未修改使用者原本的 Chrome profile。
- TypeScript 型別檢查、esbuild 建置通過；15 項 node:test 核心／fake-indexeddb 整合測試通過。
- E2E 測試使用獨立副本增加 localhost／127.0.0.1 host permissions，以隔離權限對話框。正式 dist 維持 optional_host_permissions。
- `SCHEDULE_TEST=1 npm run test:e2e`：正式一分鐘設定，成功完成兩次排程檢查，作用中 tabId 不變、沒有重複事件。alarm 可能延後，不把兩次完成時間宣稱為精準每 60 秒。
- worker 中斷測試使用 CDP `ServiceWorker.stopAllWorkers`；取樣完成訊息重新喚醒 worker 並建立一次基準，無事件。
- 5,000 節點的 jsdom 正規化＋hash＋diff：608.5 ms、42,611 bytes（一次測量）。Chrome for Testing 主文件同區域擷取 29.4 ms、42,611 bytes（一次測量；不含載入與穩定等待），見 E2E console。這不是跨平台 SLA；jsdom 數字也不是瀏覽器效能保證。

## AC 覆蓋與尚待人工確認

「部分」表示部分子條件已由自動測試確認，不能當作完整 AC 通過。沒有把未完成驗收默認為產品限制。

| AC | 自動驗證結果 | 尚待互動桌面確認 |
| --- | --- | --- |
| 01 | 首次專用分頁建立基準，零事件；選區 UI 流程納入 E2E | 真正來源權限提示與拒權 |
| 02 | 正式一分鐘跑兩輪，作用中 tabId 不變 | OS 視窗焦點、另一分頁持續操作、原頁未刷新需人工交叉確認 |
| 03 | A→B 一事件，B→B 零新增，基準 B | 真實通知顯示 |
| 04 | B→A 第二事件，前後快照完整 | 無 |
| 05 | 文字、連結、圖片絕對 URL、重複／順序與選項 canonicalization 測試通過；E2E B 改文／URL | 實站手動逐項開關 |
| 06 | NFC／空白／隱藏值／輸入值排除測試；忽略倒數下排程不產生事件 | 無 |
| 07 | 核心不讀像素、樣式或圖片 bytes，README 明列預期 | 同 URL 換 bytes、純 CSS 的人工展示 |
| 08 | 三次且至少兩秒取樣、延遲／抖動 fixture 可重現 | 60 秒持續抖動及背景節流／凍結實測 |
| 09 | 無根／多根／空根明確拒絕；既有基準不因失敗提交 | UI 各錯誤完整人工巡查 |
| 10 | 已授權其他來源仍拒絕跨來源 redirect，零快照污染 | 由 chrome://extensions 撤銷來源權限 |
| 11 | 暫停／刪除後 late commit 不復活；版本與 lease 衝突拒絕提交 | 編輯期間各時序的人工巡查 |
| 12 | worker 停止後恢復成功；IndexedDB 持久狀態及 lease 過期測試 | 完整 Chrome 關閉再重啟、重啟後殘留分頁處理 |
| 13 | 並行 acquire：全域二、來源一、同任務一；launch 有原子 claim | alarm 與按鈕同時操作的人工巡查 |
| 14 | 強制 transaction abort 全部回滾，舊資料一致 | 真實磁碟／Chrome 配額耗盡；不得用模擬 abort 宣稱配額實測 |
| 15 | 相同 runId 不重複事件；outbox claim 原子且最多三次，固定 notificationId | 通知提交後與寫 sent 前停止 worker 的 OS 實測 |
| 16 | 切入工作分頁取消且保留；後續暫停仍不關閉接管分頁 | 使用者直接關閉、手動重新導覽、視窗層級焦點 |
| 17 | URL 帳密／file／商店／無效設定拒絕；歷史只使用 textContent | 惡意匯入檔及 HTML/script 的完整 UI 人工巡查 |
| 18 | 節點／byte 超限不截斷，20 任務可建、21 拒絕 | 大區域的 UI 提示人工巡查 |
| 19 | 55 次變更清理至 50 筆，過期事件／outbox 清除，保留最後基準；清庫無關聯資料 | 確認對話框與匯入／匯出人工巡查 |
| 20 | 恢復只選到期任務一次，無補跑逐間隔；正式排程測試通過 | 真實睡眠／喚醒、離線、OS 勿擾及通知停用 |

## 人工驗收操作

1. 在 stable Chrome 手動載入 dist，記錄「關於 Chrome」完整版本、發行通道、OS。
2. `npm run fixture`；選 #products、忽略 .countdown，確認首次權限 prompt 只要求該來源。拒絕後不應建立基準；重新授權才繼續。
3. 在另一分頁輸入文字／操作，設間隔一分鐘，觀察兩輪不搶焦點，原頁可用 `window.testSentinel=1` 確認沒有被重新整理。
4. 請求 `/set?v=B`，立即檢查：一事件；再跑仍 B：無新增；`/set?v=A` 再跑：第二事件。點通知開歷史；清除歷史後再點應說明已清理。
5. 分別使用 delay／unstable／empty／ambiguous／large／login fixture；login 可設定 failureSelector=#login。失敗都不應推進基準。
6. 在 chrome://extensions 撤銷來源；確認停止檢查且沒有自動權限視窗。重新授權後手動恢復。
7. 工作進行中暫停、編輯規則、刪除；確認舊回傳不寫入。切入或導覽工作分頁後保留分頁；自行關閉則取消當次。
8. 停止 worker、重啟 Chrome、裝置睡眠再喚醒；確認無補跑風暴，無法證明所有權的舊分頁不自動關閉。
9. 開 OS 勿擾／關閉 Chrome 通知，重做 A→B，確認歷史與基準仍更新。API 回傳成功不代表 OS 顯示。
10. 歷史中加入文字 `<script>alert(1)</script>`；不得執行。匯入含 file:// 或帳密 URL 檔應拒絕；清除全部資料必須經確認。

## 完成判讀

原始碼與可載入成品已交付，核心和端到端自動化已有實測。**尚不能宣稱規格全部 AC／stable Chrome／OS 人工驗收完成**。上述待確認項目是驗收缺口，並非藉由「已知限制」免除需求。


## 1.0.1 回歸驗證（2026-10-26）

修復斷線／無法注入錯誤頁時，工作分頁無法清理且被誤判為 TAB_CLOSED 的問題。新增同 session 的分頁建立所有權與未回收容量限制；Chrome 重啟／重新載入後不憑舊 tabId 關閉分頁，舊版已留下的分頁需使用者確認後手動關閉。

- 型別檢查與建置通過，18 項核心／交易測試通過。
- `test:offline`：六次模擬 internetdisconnected，錯誤頁都回收，分頁數回到初始值，無快照／變更污染。
- 模擬 tabs.remove 失敗：殘留一個工作分頁時，同任務多次 RUN_NOW 不再建立新工作；回收恢復後可繼續。
- 恢復網路：成功建立正式基準且無假變更。
- 錯誤紀錄介面：查看、清除通過，任務與基準保留；資料庫測試確認最多 200 筆與錯誤代碼清理，不保存 DOM／URL。
- 完整 E2E 再次通過，包括 A→B→B→A、跨來源拒絕、使用者接管分頁保留、停止 worker 後恢復、選區／儲存與大區域案例。

測試使用 Chrome for Testing 151.0.7922.34，獨立 profile；網路錯誤以瀏覽器攔截模擬，沒有操作使用者實體 Wi-Fi。既有 stable Chrome／OS 人工驗收缺口仍以本文前段為準。
