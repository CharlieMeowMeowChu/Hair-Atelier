# 開發代理規則

先讀 `HairStudio_AI_Development_Masterplan_zh-HK.md` 全文及附錄 A/B，再讀 DECISIONS、RISKS、VERSIONS.lock 及最新驗證紀錄。產品與功能驗收只以原規格為正式依據；擁有人後續明確決策優先，現有 Public 決定記於 DECISIONS D01。

- 目前批准範圍：Phase 0 記錄與 Web Phase 1–2 最小技術樣板。不得超過 Cut／Curl／Grow／Undo／Redo 驗證。
- 分支及 PR 管理修改；不自行 merge、不更改可見性、不覆蓋原規格。
- 髮根固定、局部剪髮、剪後保捲不可降低。永久造型／約束／動態／渲染分層。
- 先測試、實作、跑測試、人工操作、證據、PR；不能以 TODO、預製髮型或漂亮畫面代替功能。
- Public Repo 不含原始照片、私人參考、秘密、簽章或授權檔。Git LFS 不是保密措施。
- 不代擁有人接受條款／開戶／付款；不部署或發佈遊戲。Unity、URP、C# 與原生 build 不再是技術路徑；使用 TypeScript＋Three.js＋Vite，第三方導入遵守規格 8.2。
- 一般可逆技術決策自行處理；只有重大問題、費用或必須由擁有人操作才詢問。
- 證據分清 PASS、FAIL、BLOCKED、NOT_TESTED；環境 smoke 不代表遊戲功能或裝置效能通過。
- 優先 rg、批次檢查、最少依賴、適量驗證，避免重複下載及耗用 Usage。
