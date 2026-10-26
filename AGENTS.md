# DiffWatch 專案工作約定

- 每次完成使用者要求的修改並通過相關驗證後，建立一筆 Git commit，隨即 push 到目前分支設定的遠端；回覆附短 commit hash 與 push 結果。
- 提交前檢查差異，只包含本次工作相關變更，保留其他未提交內容。
- 提交前檢查目前分支與 remote／upstream。不得強制推送或覆蓋其他人的提交；push 失敗須明確回報原因，不得宣稱已同步。

## 開發入口

- 源碼在 src，樣式與圖示在 public；dist 是建置結果。manifest／HTML 樣板在 build.mjs，不直接修改 dist。
- 修改後執行 npm run typecheck 與 npm run build；依變更範圍跑 npm test、npm run test:e2e 或 npm run test:picker。
- 執行碼變更須將更新的 dist 一起提交。純文件變更檢查內容與連結，不必無故重跑瀏覽器測試。
- 品牌名稱是 DiffWatch，npm 套件名稱是 diffwatch。保留既有 dom-watch IndexedDB 與內部標記，不因改名重建資料庫或更換使用者載入路徑。
- 不提交 node_modules、work、瀏覽器 profile、憑證或私人監控資料。
- 第一次接手先讀 doc/HANDOVER.md；建置、權限與限制參考 doc/DEVELOPMENT.md；README 以使用者快速入門為主，保持簡潔。
