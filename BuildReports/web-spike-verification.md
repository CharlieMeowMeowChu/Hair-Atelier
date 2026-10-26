# Web Core Spike 驗證紀錄

日期：2026-10-27（香港）。分支：`phase0/environment-readiness`。

## 已通過

| 檢查 | 結果 | 證據 |
|---|---|---|
| CoreHair 單元測試 | PASS | Vitest：1 test file、24 tests passed；包括局部 Cut、可調留髮長度電剪、Curl→Cut ≤0.5 mm、Grow 保捲及越過原髮尾後的連續捲曲延伸、多束單一 Undo、連剪不倒長、固定髮根、梳後剪仍保留幾何、分界不清除梳髮方向、左右夾耳狀態與 Undo、高低馬尾錨點與捲尾相對幾何、公主頭下半部保持自由、兩束共享 anchor 而保留 group ID、三股辮的相位分離與剪後資料保留、側撥保留梳髮方向、20 步 Undo、越界 Curl no-op、局部捲尾連續、左右捲向及保存資料驗證 |
| TypeScript typecheck | PASS | `tsc -b` exit 0 |
| Production build | PASS | `vite build` exit 0；產生 `dist/` |
| 本機 Web server | PASS | Vite 在 127.0.0.1:5173 回應 HTML、manifest、service worker |
| 觸控界面實作 | IMPLEMENTED | `pointerdown/move/up/cancel` 旋轉 3D 畫面；畫面與按鈕有 touch-action 限制 |
| 自由檢視手勢 | IMPLEMENTED | 單指可水平旋轉與上下傾斜；兩指 pinch 可在 0.72–2.2 m 相機距離內縮放；尚未真機驗證手勢細節 |
| 觸控剪／捲／增長原型 | IMPLEMENTED | 剪刀以畫面取樣命中並累積拖掃最低弧長，放手才 Cut；捲髮器對命中束的局部區間建立 Curl；增髮只對點按的髮束 Grow；Undo／Redo／重設可用 |
| 電剪原型 | IMPLEMENTED | 1–20 cm 可調 guard length；拖掃命中束後放手才以該長度修短，已短於 guard 的髮束不變；一次手勢一個 Undo |
| 梳子／手指撥髮原型 | IMPLEMENTED | 命中髮束後拖動以可保存的導引方向偏移撥髮；髮根固定，剪後保留段、增長與保存均保留該方向資料 |
| 分界原型 | IMPLEMENTED | 頭皮區域水平拖動，按髮根相對分界位置重新導向左右束；根部固定、既有梳髮 direction 不被清除；尚未有頭皮貼合線及區域平滑插值 |
| 夾耳後原型 | IMPLEMENTED | 點按髮束按其髮根左右側導向對應耳後，左右狀態可獨立保存及 Undo；場景有基本耳朵幾何作定位，尚未做逐束耳朵碰撞或完整耳後軌跡約束 |
| 馬尾原型 | IMPLEMENTED | 可選高／低位；點按任一髮束，把符合長度的導引束以同一後方錨點匯合；髮根固定、錨點後尾段保留自身長度及捲曲相對幾何，非預製髮型切換；目前只有高低馬尾及基本髮圈標記 |
| 公主頭原型 | IMPLEMENTED | 點按後只把示範上半部 B、C 導引束綁到獨立後方錨點，A、D 保持自由；多個髮圈錨點可同時顯示，尚未有玩家圈選髮束 UI |
| 兩束綁原型 | IMPLEMENTED | A/B 與 C/D 兩組以不同 group ID 約束到同一 anchor；一次操作可 Undo，兩組身份保留；尚未有玩家圈選任意髮束組的 UI |
| 三股辮原型 | IMPLEMENTED | B/C/D 導引束用 index 0–2 的相位分離程序化 3D 路徑交織；髮根固定，剪後 braid constraint 保留；尚未有任意三束選取、逐段編織手勢或辮尾固定 UI |
| 側撥原型 | IMPLEMENTED | 可選左／右側，把所有示範導引束加上可保存的側向偏移；髮根固定，原有 comb direction 不被清除；尚未有肩膀／耳朵碰撞及區域刷選 |
| 剪刀預覽及遮擋 | IMPLEMENTED | Three.js Raycaster 對髮束線段拾取；若頭部交點較近便排除後方髮束；命中束轉白並顯示切口環形預覽 |
| 剪刀游標 | IMPLEMENTED | 命中髮束時顯示相機朝向的雙刃剪刀游標；未命中或離開畫面時隱藏 |
| 快速拖掃 | IMPLEMENTED | 兩個 PointerEvent 之間每 8 px 補取樣；一次手勢可剪多束，並合併成單一 Undo 指令 |
| 靜止耗電控制 | IMPLEMENTED | 取消永久 animation loop；旋轉、選取、資料更新或 resize 時才要求下一幀渲染 |
| 技術 overlay | IMPLEMENTED | 即時顯示 selected strand ID、實際弧長、curl radius/pitch、cut preview 弧長及 geometry rebuild 毫秒數 |
| 局部幾何更新 | IMPLEMENTED | renderer 保留各 GuideStrand 的 Line；只替換資料 signature 改變的 geometry，並在 overlay 顯示本次 rebuild 髮束數；移除的髮束會釋放 geometry/material |
| PWA 基礎 | IMPLEMENTED | manifest；service worker 導航採 network-first、靜態資源 stale-while-revalidate，啟用時清理舊版本 cache；`node --check` 通過，未做離線真機驗證 |
| 本機儲存／讀取 | IMPLEMENTED | 每次有效髮型操作與 Undo／Redo 寫入 versioned localStorage；啟動、按鈕讀取均先驗證 schema、向量、長度、curl 區間與方向，無效資料拒絕載入；未做 Safari 重開真機驗證 |

## 尚未通過／未聲稱完成

- Safari／iPhone 16 Pro Max／iPad A16 尚未真機打開；FPS、記憶體、離線與背景恢復均為 NOT_TESTED。
- Production build 的 Three.js 主 bundle 為約 500 KB（gzip 約 128 KB），Vite 發出 chunk-size 警告；尚未做模組拆分與 iPhone/iPad 載入／記憶體量測。
- 此原型已有命中高亮、頭部遮擋 raycast 與拖掃補取樣，但尚未提供剪刀模型、密集髮束空間索引、髮束互相遮擋或 ribbon mesh 的局部重建。這些仍須在後續 Gate 3 驗收。
- 這是 4 條彩色 GuideStrand 與球體，不是全頭髮、真人模型、物理碰撞、馬尾或辮子。
- 未建立公開部署或 URL。PWA source 可 production build，但未公開或安裝到裝置。

## 重跑

```bash
npm ci
npm run check
npm run dev -- --host 127.0.0.1
```
