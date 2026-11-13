# 風險登記（Phase 0）

| ID | 項目／等級 | 應對及驗收 | 現況 |
|---|---|---|---|
| R01 | 保捲／高 | 以 Rest arc `s` 取樣比較，剪後最大偏差 ≤0.0005m；radius/pitch/phase 不變，HAIR-002/003 | 4-strand core test PASS；Gate 2 Safari 真機未驗證 |
| R02 | 行動效能／高 | iPad A16 作兩款指定裝置中保守基準；兩機獨立量測 p95、記憶體及熱狀態，LOD 不改 HairState | 未真機驗證 |
| R03 | 綁紮／編辮／高 | 實際弧長可達性、區間約束、三色繩交織，B6 與 HAIR-019–034 | 未實作 |
| R04 | 照片建模／高 | 授權素材私密儲存、不可見角度由擁有人審核，T0 先用球體 | 未有素材 |
| R05 | 跨瀏覽器／PWA／高 | 乾淨 clone 的 npm build、Safari 真機、offline shell 與 WebGL context loss 分別報告 | 桌面 build PASS；Safari 未測 |
| R06 | 第三方授權／高 | 導入前讀完整 license、固定 commit、檢查依賴及平台；目前無外部 Hair 依賴 | 未導入 |
| R07 | Public Repo／高 | 相片／秘密／簽章不提交，衍生角色資產須確認可公開；LFS 仍公開 | 擁有人選擇 Public |
| R08 | 插值與拾取精度／高 | 可見細髮與 Guide 編輯粒度一致；快掃、遮擋及局部剪口分開驗收 | Phase 2/3 spike |
| R09 | 歷史／存檔／高 | 有效區段與延伸紀錄分開，20 步持久 Undo/Redo、原子存檔及 schema migration | v2 state/history 與 v1 migration core test PASS；Safari 重開未驗證 |
| R10 | npm 依賴與 browser API／中 | package-lock、production build、PWA service worker 與 Safari API 分開標示 | 見版本表 |
| R11 | 直向手勢誤剪／高 | 模式與 pointer ownership，UI 優先；第二指／失焦取消暫存，HAIR-016/032 | Phase 3 |
| R12 | 無條件排期承諾／中 | 規格估算只是規劃；每個 Gate 有證據後再估下一步 | 保留原估算 |

Gate 2 失敗：停在核心驗證，提出替代算法及效能代價供審核，禁止刪減玩法。
