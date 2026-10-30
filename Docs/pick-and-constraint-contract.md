# 拾取與約束契約（Gate 2 前設計／單元測試）

狀態：**已建立可測試契約；不是 Gate 2、Gate 3、W09、W19 的完成宣告。**

本文件把總規格 §3.1–3.5、Phase 3、B6、B7 變成日後可重用的 TypeScript 邊界。現時仍只有 4 條彩色 GuideStrand 與球體頭；Safari 真機與完整髮量測試仍未做。

## 1. 現行座標誠實定義

現行 schema v1 的 `length`／`s` 是**材料參數（material s）**：Cut、Curl、Grow、存讀及歷史都以同一個 `s` 工作，故已能保證剪後保留同一段既有幾何；但當捲曲、耳後、綁紮或辮子改變曲線時，尚未以數值證明它等於整條 Rest centerline 的真實弧長。

因此，現有畫面把 overlay 改稱 `Material s`，不把它誤報為正式的 `totalArcLengthMeters`。在正式 Gate 2 前，W04 必須把 schema 演進為可量度的 Rest curve／arc-length lookup；舊存檔要有明確 migration，不能把原本 v1 參數靜默當成真實弧長。

這不是降低規格：總規格要求的真實弧長、0.5 mm CurlLock 與世界米誤差仍維持為 Gate 2 條件。

## 2. PickProxy：日後 W09 的唯一拾取契約

`src/pick-proxy.ts` 不依賴 Three.js renderer，輸入的是頭部 local-space 的 `PickRay` 和由 GuideStrand 衍生的 `PickSegment`：

```text
{ strandId, s0, s1, a, b, radiusMeters }
```

它計算 ray 對有限 capsule 中心線的最近點，按比例回傳 `materialS = lerp(s0, s1, segmentT)`。這取代目前樣板用 `Line.raycast().index` 直接取樣點的近似，避免切口只落在 40 段取樣點。

決定性選擇順序如下：

1. 最前的 capsule 表面深度；
2. 觸控容差內的最短距離；
3. stable `strandId`；
4. 較小 `materialS`。

頭皮／耳朵可作低成本 sphere/capsule occluder；遮擋物在候選髮束可見表面之前即拒絕。之後整合到 Three.js 時，pointer ray 先轉回 `headRig` local-space，旋轉頭部只改 ray，毋須重建整個索引。變更某髮束才重建其 PickSegment；4–20 條 GuideStrand 可線性查詢，密集髮量才加入 uniform grid/BVH。

觸控半徑由呼叫端按 camera depth、FOV、viewport 高度把 CSS px 換算成 metres。GPU ID/depth 的小範圍 readback 只可作密集髮量的 pointer-down／drag 複核，不能每幀使用，因為 Safari 可能造成 GPU/CPU 同步停頓。

現有測試：

- `pick-proxy.test.ts`：精確 `s` 插值、前方優先、頭部遮擋、stable ID tie-break、平行線段無 NaN。

真正整合前仍須補上：前／後／耳邊／最短髮束、快速 sweep、preview 與 commit 同一候選、iPhone/iPad Safari 實測。這些才是 HAIR-008、HAIR-016、HAIR-032／Gate 3 的證據。

## 3. ConstraintGraph：B6 的非破壞決策階段

`src/constraint-graph.ts` 先從 schema v1 的 `earTuck`、`tie`、`braid` 推導臨時 `ConstraintInterval`。每個 interval 有 `strandId`、`[startS,endS]`、type、owner ID 和 priority，並透過：

```text
ActionIntent → ConstraintGraph → Allowed | Partial | RequiresConfirmation | Rejected
```

在 mutation 前回傳具體原因。它不會刪除既有造型，也不會把整頭重設。

目前已固定的政策：

| 操作 | 決策 |
|---|---|
| 馬尾髮圈以下剪尾 | `Allowed`；髮圈與其他髮束保留 |
| 剪在髮圈以上 | `RequiresConfirmation`；日後預覽「只讓該束脫離」 |
| 剪／梳／捲進辮子交織段 | `RequiresConfirmation`；提示先拆辮或只操作自由尾段 |
| 馬尾下方三束自由尾段編辮 | `Allowed`；必須同一髮圈、且 braid start 在 gatherS 之後 |
| 對已綁髮束加入競爭錨點 | `Rejected`；不靜默覆寫原髮圈 |
| 已受約束髮束增長 | `Partial`；預設只增加自由尾段，不在髮圈／辮子中間補長 |
| 耳後路徑相交 | `Partial`；須有真實耳朵 path／collision 後才 commit |

`HairEditor` 現在只會直接提交 `Allowed` 的 Cut／Curl／Comb／Tie／Braid；需要確認或部分重算的操作保持 no-op，而不是假裝成功。Grow 對現行 tied/braided 樣板只延伸自由尾段，符合 B6.1 第 12 條的預設。

樣板 UI 對三束都屬同一髮圈的情況，會把 braid start 放在 `gatherS + 2 cm`，使「馬尾 → 尾端三股辮」走自由尾段；不同髮圈或長度不足仍會顯示具體拒絕原因。

現有測試：

- `constraint-graph.test.ts`：馬尾＋辮子區間排序、髮圈上下剪法、梳辮拒絕、馬尾尾端編辮、競爭錨點拒絕、約束髮尾增長、長度不足拒絕。
- `hair-core.test.ts`：競爭髮圈不能覆寫、剪辮子中段不會偷偷改資料。

## 4. 後續 schema 與 Gate 邊界

正式 B7 仍要求 schema 演進至 `StrandGroup`、頭部 local-space `Anchor`、持久 `ConstraintInterval`、`BraidGroup` 與 `ConstraintSolver`。schema v1 每束只有一個 `tie` 和一個 `braid`，足以做現行契約測試，**不足以**支援兩個依次髮圈、完整拆辮／局部脫離、或全量頭髮。

在 Gate 2 的兩部指定 Safari 真機資料未齊前：

- 不宣稱 Phase 2／Gate 2 通過；
- 不宣稱 W09、W19 或 Gate 3 完成；
- 不開始全量頭髮美術；
- 可以繼續改善資料語義、測試及可回收的純核心元件。
