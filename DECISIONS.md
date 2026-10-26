# Phase 0 決策紀錄

日期：2026-10-26（香港）。狀態：Phase 0；已批准 Web Phase 1–2 最小核心技術樣板。

正式產品與驗收依據：`HairStudio_AI_Development_Masterplan_zh-HK.md` 1.2 全文及附錄 A/B。本文件記錄執行決策；不替代或刪減規格。

| ID | 決策 | 來源／狀態 |
|---|---|---|
| D01 | 沿用 CharlieMeowMeowChu/Hair-Atelier，保持 Public，不另建私人 Repo | 擁有人明確批准；覆蓋規格中私人倉庫的預設，功能不變 |
| D02 | 分支 → PR → 審核 → merge；本次不自行合併 | 擁有人要求；main 保留原狀 |
| D03 | 單一真人風人物、離線單人、原生平台、繁體中文；完全自由操作 | 沿用規格預設 |
| D04 | 先驗證 iPhone 16 Pro Max 與 iPad A16，直向為主要操作；其他原有平台保持最終範圍 | 擁有人指定；不是刪除 Android/Windows/macOS |
| D05 | TypeScript＋Three.js＋Vite，browser-native PWA；Vitest 與 browser smoke；Blender 只作可選離線 DCC | 2026-10-26 正式技術遷移；覆蓋舊 Unity 決定，不改核心玩法 |
| D06 | 自家可編輯 Guide 資料＋衍生 ribbon；不先導入外部 Hair 系統 | 最少依賴；不把 renderer 當存檔 |
| D07 | 物理只改 DynamicPose；Rest Shape 與 ConstraintGraph 分離 | 規格 B1/B3/B7 |
| D08 | 初始中長直髮、本機存檔、畫圈選區＋細調、工具衝突先確認 | 規格 B11 預設 |
| D09 | 增髮採既有髮尾續長，不宣稱生物真實生長 | 規格 B2/3.4 |
| D10 | 批准建立最小 Web 3D 技術樣板，先驗證 Cut／Curl／Grow／Undo 與保捲；不做真人資產或高階造型 | 擁有人 2026-10-26 授權 |
| D11 | 不啟用付費服務、CI runner 或購買資產；先用現有環境本機驗證 | 節省 Usage；費用另行批准 |
| D12 | 原始照片、身份參考、簽章、憑證、Unity 授權檔不進 Public Repo | 規格私隱要求；Git LFS 不是保密工具 |

## 技術遷移紀錄

- Unity、URP、C#、Unity packages、Xcode／TestFlight 已停止作為本專案日常開發路徑；已安裝工具毋須刪除，但不再作為完成證據。
- 目標改為 iPhone 16 Pro Max、iPad A16 上的 Safari，直向 touch-first Web App／PWA。桌面 browser 只用於開發 smoke。
- PWA 離線快取不等於自動公開部署。部署、公開 URL、App Store wrapper 及 TestFlight 均未授權。

## 必須外部配合的阻塞

- Safari 真機：Mac 已有 iPhone／iPad 目標設備資訊但尚未連接本工作環境；需在兩部指定裝置手動量測 touch、FPS、記憶體及離線行為。
- 真人身份模型：未有已授權相片，不阻塞球體技術驗證；不能聲稱已製作人物。

## 待對應階段處理的語義決策

保持原需求，先在 Phase 2 設計審核確定：可剪最小 Guide／子髮粒度；剪後再梳／捲如何使下游延伸紀錄失效；受約束畫面切口映射回材料弧長。不得用整束誤剪、重設全頭或預製髮型解決。
