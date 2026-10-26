# Web Core Spike 驗證紀錄

日期：2026-10-27（香港）。分支：`phase0/environment-readiness`。

## 已通過

| 檢查 | 結果 | 證據 |
|---|---|---|
| CoreHair 單元測試 | PASS | Vitest：1 test file、10 tests passed；包括局部 Cut、Curl→Cut ≤0.5 mm、Grow 保捲、多束單一 Undo、連剪不倒長、固定髮根、20 步 Undo、越界 Curl no-op |
| TypeScript typecheck | PASS | `tsc -b` exit 0 |
| Production build | PASS | `vite build` exit 0；產生 `dist/` |
| 本機 Web server | PASS | Vite 在 127.0.0.1:5173 回應 HTML、manifest、service worker |
| 觸控界面實作 | IMPLEMENTED | `pointerdown/move/up/cancel` 旋轉 3D 畫面；畫面與按鈕有 touch-action 限制 |
| 觸控剪／捲／增長原型 | IMPLEMENTED | 剪刀以畫面取樣命中並累積拖掃最低弧長，放手才 Cut；捲髮器對命中束的局部區間建立 Curl；增髮只對點按的髮束 Grow；Undo／Redo／重設可用 |
| 剪刀預覽及遮擋 | IMPLEMENTED | Three.js Raycaster 對髮束線段拾取；若頭部交點較近便排除後方髮束；命中束轉白並顯示切口環形預覽 |
| 快速拖掃 | IMPLEMENTED | 兩個 PointerEvent 之間每 8 px 補取樣；一次手勢可剪多束，並合併成單一 Undo 指令 |
| 靜止耗電控制 | IMPLEMENTED | 取消永久 animation loop；旋轉、選取、資料更新或 resize 時才要求下一幀渲染 |
| 技術 overlay | IMPLEMENTED | 即時顯示 selected strand ID、實際弧長、curl radius/pitch、cut preview 弧長及 geometry rebuild 毫秒數 |
| PWA 基礎 | IMPLEMENTED | manifest、service worker runtime cache；未做離線真機驗證 |

## 尚未通過／未聲稱完成

- Safari／iPhone 16 Pro Max／iPad A16 尚未真機打開；FPS、記憶體、離線與背景恢復均為 NOT_TESTED。
- 此原型已有命中高亮、頭部遮擋 raycast 與拖掃補取樣，但尚未提供剪刀模型、密集髮束空間索引、髮束互相遮擋或 ribbon mesh 的局部重建。這些仍須在後續 Gate 3 驗收。
- 這是 4 條彩色 GuideStrand 與球體，不是全頭髮、真人模型、物理碰撞、馬尾或辮子。
- 未建立公開部署或 URL。PWA source 可 production build，但未公開或安裝到裝置。

## 重跑

```bash
npm ci
npm run check
npm run dev -- --host 127.0.0.1
```
