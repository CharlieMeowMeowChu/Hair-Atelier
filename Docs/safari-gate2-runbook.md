# Safari Gate 2 真機驗收記錄表

此表只用於指定的 iPhone 16 Pro Max 與 iPad A16。桌面 browser、Simulator 或 CI 不可取代此項證據。

## 執行前資料

| 欄位 | iPhone 16 Pro Max | iPad A16 |
|---|---|---|
| 日期（香港） | 待填 | 待填 |
| iOS／iPadOS 版本 | 待填 | 待填 |
| Safari 版本 | 待填 | 待填 |
| commit | 待填 | 待填 |
| 網址／本機來源 | 待填 | 待填 |
| 網絡狀態 | 待填 | 待填 |

## 必做流程

| 檢查 | iPhone 16 Pro Max | iPad A16 | 證據／備註 |
|---|---|---|---|
| 直向載入、無可見錯誤 | 待測 | 待測 | |
| 單指旋轉、兩指縮放 | 待測 | 待測 | |
| C：捲曲 → 中段剪短 | 待測 | 待測 | 保留段應無明顯拉直／跳折 |
| C：再增長，舊捲保留 | 待測 | 待測 | |
| Undo → Redo 後資料與畫面一致 | 待測 | 待測 | |
| 儲存 → 關閉／重開 → 讀取 | 待測 | 待測 | |
| 背景／前景恢復 | 待測 | 待測 | |
| Service Worker／離線重開 | 待測 | 待測 | 只於 HTTPS／安裝條件具備時測 |

## 性能與穩定性

| 指標 | iPhone 16 Pro Max | iPad A16 | 備註 |
|---|---|---|---|
| 操作期間可感知卡頓 | 待測 | 待測 | |
| app 內最近 render p95 | 待量測 | 待量測 | 只量 `renderer.render()` 耗時，不是整體 frame time |
| p95 frame time | 待量測 | 待量測 | Safari Inspector 可用時才填 |
| memory | 待量測 | 待量測 | Safari Inspector 可用時才填 |
| 5 分鐘連續操作／溫度 | 待測 | 待測 | |

Gate 2 只可在流程、資料重現及指定真機初測均有證據後評估。此樣板的 full-head 髮量、長時間壓力及正式美術效能仍屬後續 Gate。
