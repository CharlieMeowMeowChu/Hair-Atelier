# Web Core Spike 驗證紀錄

日期：2026-10-26（香港）。分支：`phase0/environment-readiness`。

## 已通過

| 檢查 | 結果 | 證據 |
|---|---|---|
| CoreHair 單元測試 | PASS | Vitest：1 test file、5 tests passed；測 Cut 只改目標束、Curl→Cut 保留前綴 ≤0.5 mm、Grow 不拉直舊捲、Undo/Redo、無效 Cut no-op |
| TypeScript typecheck | PASS | `tsc -b` exit 0 |
| Production build | PASS | `vite build` exit 0；產生 `dist/` |
| 本機 Web server | PASS | Vite 在 127.0.0.1:5173 回應 HTML、manifest、service worker |
| 觸控界面實作 | IMPLEMENTED | `pointerdown/move/up/cancel` 旋轉 3D 畫面；畫面與按鈕有 touch-action 限制 |
| PWA 基礎 | IMPLEMENTED | manifest、service worker runtime cache；未做離線真機驗證 |

## 尚未通過／未聲稱完成

- Safari／iPhone 16 Pro Max／iPad A16 尚未真機打開；FPS、記憶體、離線與背景恢復均為 NOT_TESTED。
- 畫面按鈕調用資料模型，並非觸控剪刀命中、brush sweep、遮擋拾取或局部 renderer mesh 重建；那些仍屬 Phase 3 以後。
- 這是 4 條彩色 GuideStrand 與球體，不是全頭髮、真人模型、物理碰撞、馬尾或辮子。
- 未建立公開部署或 URL。PWA source 可 production build，但未公開或安裝到裝置。

## 重跑

```bash
npm ci
npm run check
npm run dev -- --host 127.0.0.1
```
