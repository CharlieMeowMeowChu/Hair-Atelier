# Web Core Spike 驗證紀錄

日期：2026-10-27（香港）。分支：`phase0/environment-readiness`。

## 已通過

| 檢查 | 結果 | 證據 |
|---|---|---|
| Core／手勢／效能單元測試 | PASS | Vitest：6 test files、50 tests passed；包括局部 Cut、可調留髮長度電剪、Curl→Cut ≤0.5 mm、Grow 保捲、Undo/Redo、PickProxy 及 ConstraintGraph。新增 W04 Rest arc tests：不同 base／梳髮／分界／側撥下數值 Rest length 對 stored length 誤差 ≤0.05 mm、unit-speed helix、curl 邊界位置／切線連續、Curl→Cut 保留採樣點、局部 curl＋自由尾 Cut→Grow 完整恢復、v1 current／undo／redo 全部遷移至 v2，以及壞 v2 座標拒絕。 |
| TypeScript typecheck | PASS | `tsc -b` exit 0 |
| PWA shell 檢查 | PASS | `node Tools/check_pwa.mjs` 驗證 manifest、icon、HTML 引用及 Service Worker 檔案 |
| Service Worker 行為檢查 | PASS | `Tools/test_service_worker.mjs` 模擬驗證舊 cache 清理、導航 network-first、離線 fallback，以及靜態資源 stale-while-revalidate；不取代 Safari 真機快取驗證 |
| Production build | PASS | `vite build` exit 0；產生 `dist/` |
| Production bundle 預算 | PASS | `Tools/check_bundle.mjs`：最大 JS bundle ≤600 KB raw／≤150 KB gzip；此為下載量 regression guard，不取代真機 FPS／memory 量測 |
| 本機 Web server | PASS | Vite 在 127.0.0.1:5173 回應 HTML、manifest、service worker |
| 本機 Chromium browser smoke | PARTIAL | 2026-10-27 的 430×932 headless Chromium smoke 曾載入 canvas、重載後 Service Worker controller 存在、favicon 存在，無 page error／console error。2026-10-30 W04 v2 改動後，這個環境的 Chromium `--dump-dom` harness 在 15 秒內未結束，故沒有把它當成新的 PASS；unit/build 已通過，Safari 真機仍未測試。 |
| 觸控界面實作 | IMPLEMENTED | `pointerdown/move/up/cancel` 旋轉 3D 畫面；畫面與按鈕有 touch-action 限制 |
| 自由檢視手勢 | IMPLEMENTED | 單指可水平旋轉與上下傾斜；兩指 pinch 可在 0.72–2.2 m 相機距離內縮放；尚未真機驗證手勢細節 |
| 工具／鏡頭手勢優先序 | IMPLEMENTED | 只有「旋轉」模式可轉頭或縮放；選取、造型及剪髮工具的 pointer move 不會穿透成鏡頭操作；造型中出現第二指會取消未提交手勢，避免誤剪；真機多點觸控仍待驗證 |
| 回正面視角 | IMPLEMENTED | 將水平／垂直旋轉及縮放重設為固定正面視角；不修改任何 HairState 或 Undo／Redo 歷史 |
| 觸控剪／捲／增長原型 | IMPLEMENTED | 剪刀以畫面取樣命中並累積拖掃最低 Rest arc `s`，放手才 Cut；剪刀與捲髮器單次點按不會誤套用，兩者均須拖過 6 px；捲髮器對命中束的局部區間建立 Curl；增髮只對點按的髮束 Grow；Undo／Redo／重設可用 |
| 電剪原型 | IMPLEMENTED | 1–20 cm 可調 guard length；拖掃命中束後放手才以該長度修短，單次點按不會誤剪，已短於 guard 的髮束不變；一次手勢一個 Undo |
| 梳子／手指撥髮原型 | IMPLEMENTED | 命中髮束後拖動以可保存的導引方向偏移撥髮；髮根固定，剪後保留段、增長與保存均保留該方向資料 |
| 分界原型 | IMPLEMENTED | 頭皮區域水平拖動超過 6 px 後，按髮根相對分界位置重新導向左右束；根部固定、既有梳髮 direction 不被清除；尚未有頭皮貼合線及區域平滑插值 |
| 夾耳後原型 | IMPLEMENTED | 點按髮束按其髮根左右側導向對應耳後，左右狀態可獨立保存及 Undo；場景有基本耳朵幾何作定位，尚未做逐束耳朵碰撞或完整耳後軌跡約束 |
| 馬尾原型 | IMPLEMENTED | 可選高／低位；點按任一髮束，把符合長度的導引束以同一後方錨點匯合；髮根固定、錨點後尾段保留自身長度及捲曲相對幾何，非預製髮型切換；目前只有高低馬尾及基本髮圈標記 |
| 公主頭原型 | IMPLEMENTED | 點按後把選取組別綁到獨立後方錨點；沒有選取時使用示範上半部 B、C，A、D 保持自由；多個髮圈錨點可同時顯示，尚未有頭皮區域式選取或髮圈碰撞 |
| 兩束綁原型 | IMPLEMENTED | 先選取兩束或以上，按髮根位置分成左右兩組，以不同 group ID 約束到同一 anchor；一次操作可 Undo，兩組身份保留；尚未有自由圈選、逐束指定左右組別或髮圈碰撞 |
| 三股辮原型 | IMPLEMENTED | 選中剛好三束時使用該組別，否則以 B/C/D 導引束用 index 0–2 的相位分離程序化 3D 路徑交織；如三束同屬一個髮圈，樣板會從髮圈以下自由尾段開始編辮；髮根固定，剪入辮段會被保護而要求先處理約束；尚未有逐段編織手勢或辮尾固定 UI |
| 側撥原型 | IMPLEMENTED | 可選左／右側，把所有示範導引束加上可保存的側向偏移；髮根固定，原有 comb direction 不被清除；尚未有肩膀／耳朵碰撞及區域刷選 |
| 髮束選取 | IMPLEMENTED | 選取工具可點按切換髮束群組；馬尾、公主頭會套用選取組別；兩束或以上可建立按髮根位置分組的兩束綁；選中剛好三束時三股辮使用該組別，否則使用示範 B/C/D；重設或「取消選取」會清空選取 |
| 剪刀預覽及遮擋 | IMPLEMENTED | Three.js Raycaster 對髮束線段拾取；命中半徑按 pinch 後鏡頭距離調整；若頭部交點較近便排除後方髮束；命中束轉白並顯示切口環形預覽；尚未做真機觸控容差驗證 |
| 剪刀游標 | IMPLEMENTED | 命中髮束時顯示相機朝向的雙刃剪刀游標；未命中或離開畫面時隱藏 |
| 快速拖掃 | IMPLEMENTED | 剪刀／電剪超過 6 px 拖動門檻後才啟動；兩個 PointerEvent 之間每 8 px 補取樣；一次手勢可剪多束，並合併成單一 Undo 指令 |
| 靜止耗電控制 | IMPLEMENTED | 取消永久 animation loop；旋轉、選取、資料更新或 resize 時才要求下一幀渲染 |
| 技術 overlay | IMPLEMENTED | 即時顯示 selected strand ID、Rest arc `s`、curl radius/pitch、cut preview `s`、geometry rebuild 毫秒數及最近 120 次 render 的 p95 耗時；render p95 不等於整體 frame time。W04 core 以 schema v2／`ArcLengthSampler` 實作並測試真實 Rest arc length；Safari 真機 Gate 2 仍未完成，見 `Docs/pick-and-constraint-contract.md`。 |
| 局部幾何更新 | IMPLEMENTED | renderer 保留各 GuideStrand 的 Line；只替換資料 signature 改變的 geometry，並在 overlay 顯示本次 rebuild 髮束數；移除的髮束會釋放 geometry/material；A–D 保留示範色，新增穩定 ID 會有決定性 fallback 色，支援日後擴至 20 條導引束 |
| PWA 基礎 | IMPLEMENTED | manifest、內建 SVG app icon／favicon、iOS standalone／status-bar metadata；service worker 導航採 network-first、靜態資源 stale-while-revalidate，啟用時清理舊版本 cache；語法與行為模擬測試通過，未做離線或加入主畫面真機驗證 |
| 本機儲存／讀取 | IMPLEMENTED | 每次有效髮型操作與 Undo／Redo 寫入 `editor-history.v2` localStorage；現行存檔包含當前狀態及最多 20 步 Undo／Redo 歷史，讀取會驗證每個 history snapshot；舊 v1 single HairState 與 v1 history 會遷移為 v2，且保留舊 key 不刪除；未做 Safari 重開真機驗證 |

## 尚未通過／未聲稱完成

- Safari／iPhone 16 Pro Max／iPad A16 尚未真機打開；FPS、記憶體、離線與背景恢復均為 NOT_TESTED。
- Production build 的 Three.js 主 bundle 為約 511 KB（gzip 約 131 KB），Vite 發出 chunk-size 警告；已試明確 named imports 而體積無實質下降，尚未做動態模組拆分與 iPhone/iPad 載入／記憶體量測。
- 此原型已有命中高亮、頭部遮擋 raycast 與拖掃補取樣；另有未接入畫面的純 TypeScript PickProxy／ConstraintGraph 契約與單元測試。尚未提供剪刀模型、密集髮束空間索引、髮束互相遮擋或 ribbon mesh 的局部重建。這些仍須在後續 Gate 3 驗收。
- 這是 4 條彩色 GuideStrand 與球體，不是全頭髮、真人模型、物理碰撞、馬尾或辮子。
- 未建立公開部署或 URL。PWA source 可 production build，但未公開或安裝到裝置。

## 重跑

```bash
npm ci
npm run check
npm run dev -- --host 127.0.0.1
```
