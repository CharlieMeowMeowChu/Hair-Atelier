# Phase 1–2 可驗證工作單（Web 方案）

每單依次：分支、先寫會失敗的測試、最小實作、測試、操作錄影、PR。失敗不得標完成。2026-10-26 起以 TypeScript＋Three.js Web App／PWA 執行；舊 Unity 工作單已由規格 1.2 第 0.1 節取代。

| 順序 | 工作 | 依賴／完成證據 |
|---|---|---|
| P1-01 / W03 | 鎖定 Node、TypeScript、Vite、Three.js、Vitest，記錄 package-lock | `npm ci` 與 `npm run build` 成功 |
| P1-02 / W03 | HairSandbox：camera、光、球體、A/B/C/D 彩色髮束，無正式美術 | 直向 canvas 可旋轉；PWA shell 可載入 |
| P1-03 / W03 | core unit test、production build、browser smoke、Safari 接續途徑 | exit code＋測試結果＋build output；指定真機未測則標 NOT_TESTED |
| P2-01 / W04 | stable ID、材料弧長及取樣、最小 ribbon | 節點增減曲線連續，根部穩定；數值可查 |
| P2-02 / W05 | 指定 ID/s Cut，局部重建及切口插值 | HAIR-001/004/005；其他束完整狀態不變，重剪 no-op |
| P2-03 / W06 | 真 3D CurlSegment 及 CurlLock | HAIR-002；保留前綴最大偏差 ≤0.0005m，捲參數不變 |
| P2-04 / W07 | Grow 舊記錄恢復＋連續外推 | HAIR-003；舊採樣點不變，過渡連續，不 Scale Y |
| P2-05 / W08 | 可序列化指令、20 步持久 Undo/Redo、Save/Load | HAIR-006/007；hash 及可見幾何一致，重啟後歷史可用 |
| P2-06 | 核心組合驗證及指定 Safari 初測 | 捲→剪→增→Undo/Redo→存→重啟→讀；影片、真機 OS/版本/commit/p95/memory |

Gate 2 全數通過才開始全量頭髮美術。4–20 條成功不能宣稱全頭髮量效能成功。W09 完整拾取、W16 完整選區及 W19 完整衝突處理仍保留原階段；早期只定義工具需要的資料介面，不跳過後續驗收。

## 裝置及操作計劃

- iPhone 16 Pro Max、iPad A16：Safari PWA、主要直向；裝置實際 OS 尚待提供。Android/Windows/macOS browser 保留最終測試範圍。
- 規格手機 30fps 基本目標、相容平板 60fps 調校目標；報告 p95 幀時間，不能以桌面 FPS 代替。
- 核心全頭 benchmark：直髮、滿頭捲、長度上限、持續剪 5 分鐘；後期另加馬尾及辮子、20 分鐘熱穩定觀察。
- 參數：Guide 數、節點數、render strands、解析度、LOD、solver 迭代、memory 及溫度狀態一併記錄；未量測不鎖髮量／記憶體承諾。
- 前／側／後視角、UI 點按、第二指、取消、切背景及 safe area 均需測試。
