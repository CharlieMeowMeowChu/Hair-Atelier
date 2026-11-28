# Web Core Spike 驗證紀錄

最新驗證：2026-11-28（香港）。分支：`phase0/environment-readiness`。

## 已通過

| 檢查 | 結果 | 證據 |
|---|---|---|
| Core／手勢／效能單元測試 | PASS | Vitest：24 test files、144 tests passed；包括局部 Cut、可調留髮長度電剪、Curl→Cut ≤0.5 mm、Grow 保捲、Undo/Redo、PickProxy 及 ConstraintGraph。新增 W04 Rest arc tests：不同 base／梳髮／分界／側撥下數值 Rest length 對 stored length 誤差 ≤0.05 mm、unit-speed helix、curl 邊界位置／切線連續、Curl→Cut 保留採樣點、局部 curl＋自由尾 Cut→Grow 完整恢復、v1 current／undo／redo 全部遷移至 v2，以及壞 v2 座標拒絕；另有 rendered-line segment→Rest arc `s` 插值、端點 clamp、退化段與最小 ribbon 幾何測試。 |
| Dependency audit | PASS | 2026-10-30：`npm audit --json`（production 與 development dependencies）回報 0 vulnerabilities；唯一 runtime dependency 為 `three@0.180.0`，套件宣告 MIT license。Vitest 已升至 5.0.5 以移除舊測試鏈的漏洞。 |
| TypeScript typecheck | PASS | `tsc -b` exit 0 |
| PWA shell 檢查 | PASS | `node Tools/check_pwa.mjs` 驗證 manifest、icon、HTML 引用及 Service Worker 檔案 |
| Service Worker 行為檢查 | PASS | `Tools/test_service_worker.mjs` 模擬驗證完整快取、資源格式／完整性、失敗時保護舊 cache、同名 cache 驗證、跨 scope 隔離、更新等待，以及離線背景更新不產生未處理錯誤；不取代 Safari 真機驗證。 |
| 正式建置離線及更新 | PASS | 本機 Chromium 全新 profile 首次在線載入後停止伺服器，離線重開成功顯示畫布、讀回髮型，離線修改、儲存、再重開及 Undo／Redo 通過。另以子路徑測試損壞資源的更新被拒、舊分頁保持舊版、關閉舊分頁後新版本啟用及離線存檔保留；均非 iPhone／iPad 實測。 |
| 離線準備提示 | PASS | 桌面 Chromium 子路徑正式建置驗證首次下載中、完整快取後顯示備妥、資源校驗失敗與快取被刪除後不顯示備妥；亦驗證損壞更新保留舊版提示、更新等待及新版本啟用。Worker 會重新驗證現用 shell 的資源完整性；不是 Safari 真機驗收。 |
| 既有離線版本重新註冊失敗 | PASS | 桌面 Chromium 正式建置模擬延遲拒絕和同步錯誤，現用 controller 重新驗證後仍顯示備妥；無回覆或快取被清除時顯示未確認。另停止伺服器、離線重載及核對 IndexedDB 歷史；並非 Safari 真機測試。 |
| Production build | PASS | `vite build` exit 0；產生 `dist/` |
| Production bundle 預算 | PASS | `Tools/check_bundle.mjs`：最大 JS bundle ≤600 KB raw／≤150 KB gzip；此為下載量 regression guard，不取代真機 FPS／memory 量測 |
| 本機 Web server | PASS | Vite 在 127.0.0.1:5173 回應 HTML、manifest、service worker |
| 本機 Chromium browser smoke | PASS | 2026-10-30：`npm run check:browser` 以 430×932 headless Chromium、DevTools Protocol 啟動本機 Vite，確認 canvas=1、`Rest arc s` overlay、模擬單指拖動及雙指 pinch 後畫面有變化；820×1180 tablet CSS layout 有單一 canvas、4 欄工具格及 ≥44px touch targets；按儲存後 IndexedDB v2 history 可讀回，重載後會自動讀回；待 Service Worker 接管後斷網重載仍可載入 canvas，且無 app runtime／console error（Vite 的預期 HMR 斷線訊息除外）。並驗證 430×932 直向 phone layout 的文件高度不超出 viewport、七個常用工具及「更多工具」入口存在。此為本機 smoke，不能取代 iPhone／iPad Safari 證據。 |
| 頭顱碰撞展示層 | IMPLEMENTED | 以橢球 collider 保留髮根，對穿頭的 render／pick centerline 線段插入繞行點及對應 Rest arc `s`；HairState 與歷史資料不會被改寫。數值測試涵蓋示範髮束捲、剪、增長時的中心線及部分髮片三角面；指定範例的可見髮片剪後保形亦已測試。若碰撞路徑無法安全建立，例如舊存檔髮根位於頭內，該束會被隱藏並排除拾取，顯示持續警示，原資料保留；不能聲稱所有情況均已防穿模。 |
| 直向工具版面 | IMPLEMENTED | iPhone 直向主畫面固定在 viewport 內；旋轉、選取、剪刀、電剪、捲髮器、梳子、增髮及「更多工具」直接可按，餘下造型工具使用 modal drawer 開啟，不需上下捲動。Safari 真機可用性仍待最後一輪驗證。 |
| 觸控界面實作 | IMPLEMENTED | `pointerdown/move/up/cancel` 旋轉 3D 畫面；canvas 為 `touch-action: none`，所有按鈕與 select 的實際點按高度至少 44px，並由本機 browser smoke 檢查 |
| 自由檢視手勢 | IMPLEMENTED | 單指可水平旋轉與上下傾斜；兩指 pinch 可在 0.72–2.2 m 相機距離內縮放；尚未真機驗證手勢細節 |
| 工具／鏡頭手勢優先序 | IMPLEMENTED | 只有「旋轉」模式可轉頭或縮放；選取、造型及剪髮工具的 pointer move 不會穿透成鏡頭操作；造型中出現第二指會取消未提交手勢，避免誤剪；真機多點觸控仍待驗證 |
| 多指誤操作保護 | PASS | 桌面 Chromium 真實 CDP 觸控測試涵蓋增髮與剪刀：三指、先接觸介面再觸畫布、首指抬起後加入新指，均無意外修改髮型及 IndexedDB 歷史；系統觸控取消後資料保留，所有手指離開後單指操作恢復。既有雙指旋轉縮放及平移 smoke 仍通過；Safari 真機未測。 |
| 回正面視角 | IMPLEMENTED | 將水平／垂直旋轉及縮放重設為固定正面視角；不修改任何 HairState 或 Undo／Redo 歷史 |
| 觸控剪／捲／增長原型 | IMPLEMENTED | 剪刀會把 Three.js Line 命中的 rendered segment 投影並插值為 Rest arc `s`，再累積拖掃最低值，放手才 Cut；仍未使用完整 PickProxy／capsule 可見性策略。剪刀與捲髮器單次點按不會誤套用，兩者均須拖過 6 px；捲髮器對命中束的局部區間建立 Curl；增髮只對點按的髮束 Grow；Undo／Redo／重設可用 |
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
| 最小 Guide ribbon | IMPLEMENTED | 每條 Rest arc sample 生成窄、雙面的 3D ribbon；以平行傳輸近似保持寬度，重複 sample 仍產生有限幾何。ribbon 只屬 render 衍生物，中心線仍是唯一可編輯資料；不是最終髮絲／髮片美術。 |
| 局部幾何更新 | IMPLEMENTED | renderer 同時保留每條 GuideStrand 的不可見 Line 拾取中心線與可見 ribbon；只替換資料 signature 改變的兩種 geometry，並在 overlay 顯示本次 rebuild 髮束數；移除的髮束會釋放 geometry/material；A–D 保留示範色，新增穩定 ID 會有決定性 fallback 色，支援日後擴至 20 條導引束 |
| PWA 基礎 | IMPLEMENTED | manifest、內建 SVG app icon／favicon、iOS standalone／status-bar metadata；正式建置為整套 shell 產生內容版本與完整性值，安裝完成後才可離線使用；新版等待舊受控分頁關閉後啟用。開發模式仍使用 runtime cache。未做 Safari 離線或加入主畫面真機驗證。 |
| 本機儲存／讀取 | IMPLEMENTED | 每次有效髮型操作與 Undo／Redo 寫入 IndexedDB `hair-atelier/editor-history/current-v4`；一般新編輯保留最多 20 步 Undo；現行格式可保留既有存檔的 Undo／Redo 合計最多 40 筆快照，讀取會驗證每個 history snapshot；舊 localStorage v2、v1 history 與 v1 single HairState 會兼容讀取，並在下次儲存或編輯時寫入 IndexedDB；舊 key 保留不刪除；未做 Safari 重開真機驗證 |
| 啟動讀檔保護 | PASS | 桌面 Chromium 延遲 IndexedDB 開啟期間，儲存、重設及畫布操作被暫停；讀取完成後原存檔與原髮長保留並恢復操作。此為本機模擬，並非 Safari 真機測試。 |
| 讀檔失敗後恢復 | PASS | 桌面 Chromium 模擬 IndexedDB 暫時讀取失敗，原存檔保留；恢復後手動讀入有效髮型，修改及儲存，重載仍保留修改。修正前同一測試失敗；損壞存檔及跨分頁衝突保護仍通過。這是本機模擬，並非 Safari 真機測試。 |
| 舊版 localStorage 與新版存檔衝突 | PASS | 隔離 Chromium 驗證舊頁於遷移前、提交期間、遷移後及新版關閉期間修改舊鍵時，可偵測並保護資料；重載／手動讀取不會靜默解除衝突保護。亦測試較高優先鍵新增、來源標記損壞及值為 undefined、缺少 crypto.subtle 時的精確本機備援；並非 Safari 或實際區網 HTTP 真機測試。 |
| 衝突存檔備份下載 | PASS | 桌面 Chromium 在隔離 profile 中實際下載 JSON，核對新版／舊版原文、來源標記及本頁未儲存歷史；取消、讀取期間舊鍵變更、不支援資料類型和關閉重開的競態均不會改寫原資料。430×932 下入口及 modal 觸控尺寸通過；不代表 Safari 真機下載已驗證。 |
| 滿容量歷史讀寫 | PASS | 原本已接受的 20 筆 Undo＋20 筆 Redo 可完整搬移、序列化與讀回；單元測試逐步遍歷 40 個狀態並還原，亦驗證一般新編輯維持 20 步限制。桌面 Chromium 以 IndexedDB 驗證 Undo、重載及 Redo 後 40 筆快照一致；並非 Safari 真機測試。 |
| WebGL 中斷與恢復 | PASS | 桌面 Chromium 以 `WEBGL_lose_context` 實際觸發中斷／恢復；驗證未完成手勢取消、其他編輯鎖定、中斷期間可儲存、髮型與歷史保留、重新渲染後操作及 Undo，並測試啟動及手動讀檔時中斷。只改顯示及輸入保護層，沒有改 HairState。Safari 真機未測。 |
| WebGL 初次啟動失敗 | PASS | 桌面 Chromium 分別模擬建立 WebGL 返回 null 與拋錯，畫面顯示可操作的重新載入按鈕，髮型編輯及儲存保持停用，本機存檔與歷史不被改寫；重新載入後可讀回髮型。此為本機模擬，Safari 真機未測。 |

## 增長超出已記錄髮尾

樣板可在恢復已記錄髮型後，沿直髮尾或延續至記錄末端的捲髮段繼續增長；數值與顯示前綴、連續切線、Undo／Redo 均有自動測試。樣板暫設 2 m 運算上限（已有紀錄更長則保留），此數值需真機量測並調校，不是最終產品髮長標準。頭頸肩碰撞及指定裝置驗收仍未完成。

## 重疊捲髮樣板

支援選定有限長度重捲已有捲曲的中段，前綴世界座標保持、後綴保留局部捲曲幾何並接續新方向；後綴世界位置可以隨中段改變。v4 獨立存檔記錄後段取向，舊存檔沿用原算法。桌面 Chromium smoke 實際透過畫布選取 C 髮束中段、選 5 cm 重捲，檢查三段捲髮資料、其他束不變、Undo／Redo、IndexedDB 與重載一致。退化取向無法安全推導時會拒絕而保留資料；實際 iPhone／iPad 操作及完整造型驗收仍待驗證。

剪短後重捲到可見髮尾時，會保留已記錄的隱藏尾段，無論原本是直髮還是捲髮；增長時接續恢復，其位置可隨前段重捲而改變。增長超過已記錄末端時，才按照該末端的直髮或捲髮形狀續長。

## 尚未通過／未聲稱完成

- 多指保護仍依賴瀏覽器交付接觸結束或取消事件；若系統吞掉這些事件且沒有失焦／背景通知，可能保守地維持編輯鎖定。iPhone／iPad Safari 系統手勢及恢復次序仍須真機測試。
- iPhone 16 Pro Max 曾由擁有人打開並初步操作較早版本；最新修改未在真機重新驗證，iPad A16、FPS、記憶體、離線與背景恢復仍為 NOT_TESTED。
- 中段重捲令修改區之前的髮片邊界移位：改用入向切線及 5 mm 固定取樣後，原本偏移約 0.565 mm 的非網格案例通過；16 組指定起點與方向的前綴表面雙向採樣距離 ≤0.5 mm，完整髮片三角面亦通過頭顱碰撞測試。相鄰段安全寬度改用獨立截面並共用細分接縫；原先合成案例的前段偏移約 2.35 mm，修正後保留前段，測試交界前、交界及交界後的裁剪與三角面防穿。此矩陣不是所有捲曲參數或裝置畫面的證明，接縫外觀與效能仍須真機驗證。
- 接縫組合回歸：在實際示範髮束 D 使用指定捲曲參數，增長至 0.44 m 後出現 0.42 m 接縫；於接縫前、接縫及接縫後剪髮，再增長、序列化／讀取 history、Undo／Redo，對應髮片幾何逐元素一致，剪前／剪後三角面亦通過橢球碰撞檢查。這是程式化參數與 history 序列化測試，並非 iPhone 實測或本案例的 IndexedDB 操作測試。
- 桌面 Chromium 以 IndexedDB 注入髮根位於頭內的有效存檔：顯示警示且手機尺寸不超出畫面，無法安全顯示的髮束不能以指標命中，正常髮束對照可命中；明確儲存後原 history 未改，載入正常存檔後警示消失。此為本機模擬，並非 Safari 真機驗收。
- 已修正存檔端點容差不一致：曲線與增長以暫態有效區間處理 schema 接受的 1 nm 內重疊／越界，不因讀取或顯示改寫舊數據；測試涵蓋末段續捲、原本直尾、極短重疊段、可見髮片、存讀及 Undo／Redo。若極端退化數值無法穩定求出續接方向，會拒絕該次增長並保留資料。
- 已修正容差內重疊紀錄重捲後可能無法讀回，以及未選中捲段被誤改方向的問題；重捲依有效區間判斷，保留其他原始紀錄的順序並在提交前驗證資料。若無法安全保留重疊紀錄，該次操作會顯示原因並保留原髮型；此特殊情況尚未支援成功重捲。
- 瀏覽器若沒有恢復 WebGL，或渲染因其他原因拋錯，畫面維持提示並暫停編輯，仍可嘗試儲存；首次建立 WebGLRenderer 失敗時可顯示提示並由使用者重新載入，能否成功取決於瀏覽器及裝置；之後其他初始化步驟拋錯未在此回歸範圍內。指定 iPhone／iPad 的中斷恢復未測。
- 從既有 20＋20 步歷史移動出單側超過 20 筆的 v4 存檔後，舊版程式可能無法讀取並會啟用存檔保護；一般跨分頁寫入衝突已在桌面測試，這個特定情況尚未以新舊程式同時開啟實測。
- 衝突備份是準備當刻的本機 JSON 快照，不等於自動解決衝突；目前尚未提供備份匯入、選擇或合併版本。若 IDB 有無法無損編碼的資料類型會拒絕匯出並保留原資料；首次無法建立 3D 畫面時尚未有備份入口。iPhone／iPad Safari 下載未測。
- localStorage 與 IndexedDB 不支援共同原子交易；來源標記與新版存檔在 IndexedDB 內原子保存，並於提交後、跨頁事件、回前景及重載時核對舊鍵。既有 v4 沒來源標記，或標記被單獨刪除時，建立基準前的新舊次序無法推斷；已偵測衝突目前只保留兩份並暫停儲存，尚無介面選擇或合併版本。缺少加密 API 時使用精確原文備援，佔用本機額外空間；空間不足會拒絕寫入。
- 儲存保護僅在手動讀取並採納有效存檔後解除；若仍讀不到有效存檔，保護維持啟用，暫未提供在無存檔情況下解除保護的流程。
- 若重新註冊與查詢現有 registration 都失敗，仍會驗證現用 controller，但未能確認是否有等待中的更新；Safari 的實際行為尚待真機驗證。
- 離線提示表示最近一次檢查時程式 shell 完整，不保證瀏覽器稍後不會清理快取，亦不代表存檔寫入已成功；頁面回到前景或網絡狀態改變時會再檢查。指定裝置 Safari 仍未驗證。
- 首次離線 app shell 及離線背景更新錯誤已在桌面測試修正；這不代表指定 iPhone／iPad Safari 離線驗收已通過。正式版更新為避免混合版本，會等待舊受控分頁全部關閉後啟用；完整性驗證失敗會保留舊版 cache；若已有不完整的同名 cache 而仍有 active／waiting worker，會拒絕安裝以保護現用資料，這種情況暫未自動修復。
- 加密取樣增加運算：本機 Node 單束路徑與髮片重建、預熱後各 30 次的中位數，0.4 m 為約 0.46→1.02 ms，2 m 為約 0.95→2.27 ms；分別由 63→123、203→403 個點。這不是瀏覽器或真機 FPS 測量，裝置效能仍待驗證。
- 同機 Node 粗略比較接縫修正前後：0.4 m 中位數約 0.70→1.08 ms，2 m 約 1.14→2.13 ms；此兩個示範髮束各為 160／800 個可見三角形，測量受負載與執行期影響，不代表所有頭髮或 iPhone／iPad 效能。
- Production build 的 Three.js 主 bundle 為約 518 KB（gzip 約 134 KB），Vite 發出 chunk-size 警告；已試明確 named imports 而體積無實質下降，尚未做動態模組拆分與 iPhone/iPad 載入／記憶體量測。
- 此原型已有命中高亮、頭部遮擋 raycast、拖掃補取樣及最小 Guide ribbon；另有未接入畫面的純 TypeScript PickProxy／ConstraintGraph 契約與單元測試。尚未提供密集髮束空間索引、髮束互相遮擋、最終髮絲／髮片材質或 ribbon LOD。這些仍須在後續 Gate 3／4 驗收。
- 這是 4 條彩色 GuideStrand 與球體，不是全頭髮、真人模型、完整物理碰撞或完整馬尾／辮子系統；上表所列的馬尾、公主頭、兩束綁與三股辮只屬資料／互動原型。
- 此 PR 每次更新會由既有 GitHub Vercel integration 自動建立 Preview deployment。2026-10-30 由未登入環境讀取時回傳 Vercel SSO 登入頁，故它不是公開的 Safari Gate 2 網址；已登入 project 帳戶才可使用。它不是正式發佈、未作 Safari／Gate 驗收，亦不代表已安裝到裝置；本次沒有手動部署、production release 或 merge。

## 重跑

```bash
npm ci
npm run check
npm run dev -- --host 127.0.0.1
```

本機 Chromium 離線與升級驗證（須先完成 `npm run build`）：

```bash
npm run check:offline-browser
npm run check:offline-readiness
npm run check:offline-registration
npm run check:legacy-race
npm run check:legacy-insecure
npm run check:conflict-backup
npm run check:conflict-backup-storage
npm run check:offline-upgrade
npm run check:context-browser
npm run check:multitouch-browser
npm run check:startup-browser
```

本機 Node 單束重建基準（結果受機器負載影響）：

```bash
./node_modules/.bin/esbuild Tools/benchmark-ribbon.ts --bundle --platform=node --format=cjs --outfile=/tmp/hair-atelier-bench.cjs
node /tmp/hair-atelier-bench.cjs
```
