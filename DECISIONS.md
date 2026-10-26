# Phase 0 決策紀錄

日期：2026-10-26（香港）。狀態：Phase 0；並未批准 Phase 1–2 遊戲功能實作。

正式產品與驗收依據：`HairStudio_AI_Development_Masterplan_zh-HK.md` 1.1 全文及附錄 A/B。原檔保留不變。本文件記錄執行決策；不替代或刪減規格。

| ID | 決策 | 來源／狀態 |
|---|---|---|
| D01 | 沿用 CharlieMeowMeowChu/Hair-Atelier，保持 Public，不另建私人 Repo | 擁有人明確批准；覆蓋規格中私人倉庫的預設，功能不變 |
| D02 | 分支 → PR → 審核 → merge；本次不自行合併 | 擁有人要求；main 保留原狀 |
| D03 | 單一真人風人物、離線單人、原生平台、繁體中文；完全自由操作 | 沿用規格預設 |
| D04 | 先驗證 iPhone 16 Pro Max 與 iPad A16，直向為主要操作；其他原有平台保持最終範圍 | 擁有人指定；不是刪除 Android/Windows/macOS |
| D05 | Unity 6.3 LTS、URP、C#、Input System、Unity Test Framework；Blender 作 DCC | 沿用規格；精確安裝及驗證狀態見 VERSIONS.lock.md |
| D06 | 自家可編輯 Guide 資料＋衍生 ribbon；不先導入外部 Hair 系統 | 最少依賴；不把 renderer 當存檔 |
| D07 | 物理只改 DynamicPose；Rest Shape 與 ConstraintGraph 分離 | 規格 B1/B3/B7 |
| D08 | 初始中長直髮、本機存檔、畫圈選區＋細調、工具衝突先確認 | 規格 B11 預設 |
| D09 | 增髮採既有髮尾續長，不宣稱生物真實生長 | 規格 B2/3.4 |
| D10 | 目前只建立／測試環境工具，不實作剪髮或正式遊戲場景 | 本次 Phase 0 範圍 |
| D11 | 不啟用付費服務、CI runner 或購買資產；先用現有環境本機驗證 | 節省 Usage；費用另行批准 |
| D12 | 原始照片、身份參考、簽章、憑證、Unity 授權檔不進 Public Repo | 規格私隱要求；Git LFS 不是保密工具 |

## 必須外部配合的阻塞

- Unity 授權：沒有注入 Unity 帳戶／授權設定。不得代擁有人接受條款、猜測資格或繞過啟用；以實際啟動紀錄為準。
- Apple：目前工作環境為 Linux，沒有 Xcode 或已連接真機。擁有人已確認「有 Mac，尚未設定 Unity」；Mac 尚未接入本工作環境，macOS/晶片/真機 OS 未提供。須完成 Mac／Xcode／Unity 設定及簽章途徑才能驗證 iOS。沒有要求現在上架或購買帳戶。
- 真人身份模型：未有已授權相片，不阻塞球體技術驗證；不能聲稱已製作人物。

## 待對應階段處理的語義決策

保持原需求，先在 Phase 2 設計審核確定：可剪最小 Guide／子髮粒度；剪後再梳／捲如何使下游延伸紀錄失效；受約束畫面切口映射回材料弧長。不得用整束誤剪、重設全頭或預製髮型解決。
