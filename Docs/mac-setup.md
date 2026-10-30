# Mac／Safari 接續設定（Web PWA 現行路徑）

本文件取代舊 Unity／Xcode 接續步驟。專案已採 **TypeScript＋Three.js Web App／PWA**；Unity、Xcode、Apple Developer Program 與 TestFlight 均不是目前開發或 Gate 2 驗收的前提。

已知硬件：MacBook Air M1（2020，8 GB）。不需提供帳戶、序號、裝置序號、授權檔或任何密碼。

## 在 Mac 驗證本機樣板

1. 安裝 Node.js 24.19.0（版本由 repo `.nvmrc` 固定），clone repo 並切到 PR 分支。
2. 在 repo 根目錄執行：

   ```bash
   nvm use
   npm ci
   npm run check
   npm run dev -- --host 0.0.0.0
   ```

3. 確認 Safari 開啟顯示的本機網址後，直向檢查畫面可載入、可旋轉、無明顯錯誤。

## iPhone 16 Pro Max／iPad A16 的 Gate 2 初測

1. 確保測試裝置與 Mac 在同一個可信任網絡；以 Safari 開啟 Mac 顯示的本機網址。未建立 HTTPS 公開部署前，不把 PWA「加入主畫面」或離線快取當作已驗證。
2. 在直向完成：C 髮束捲曲 → 剪到中段 → 增長 → Undo → Redo → 儲存 → 關閉／重開頁面 → 讀取。
3. 記錄實際 iOS／iPadOS 版本、commit、結果、是否有 console error、手勢問題及裝置溫度感受；Safari Web Inspector 可用時才額外記錄 p95 frame time 與 memory。
4. 將結果填入 [Safari Gate 2 記錄表](safari-gate2-runbook.md)。任何失敗、未知或未量測都照實填寫，不以桌面測試替代。

公開部署、HTTPS 網域、App Store wrapper、TestFlight、付費帳戶或上架均不在本文件授權範圍內。
