# 髮型領域契約（Phase 0）

依據規格 3、B1–B3、B6–B7。本文件整理既有語義，沒有實作算法。

- 單位為米；s 為從固定髮根沿材料曲線量度的弧長，0≤s≤L。髮長不是世界高度。
- Root Map → Natural Rest Shape → Styled Rest Shape → Constrained Target → DynamicPose → Rendered Hair。永久資料不由每幀物理或 LOD 覆蓋。
- Guide stable ID、頭皮三角形／重心座標及頭皮版本穩定。更換頭皮拓撲需明確 migration，不靜默重配髮根。
- Cut 僅截去切口下游；單純 Cut 的保留 Styled Rest Shape 前綴最大偏差 ≤0.5mm，radius/pitch/phase 不變；其他髮束 canonical state 不變。
- 梳理／分界可改髮形大方向；綁紮增加局部約束。這些不是單純 Cut；仍需保留既有長度與捲曲資料。數據與可見捲形均驗收。
- Grow 先接續同一髮束保存的下游，再按尾部曲率／相位延伸；不縮放既有幾何。不把魔法增長當毛囊真實生長。
- 活躍 style interval 必須在有效長度內；被剪下游紀錄另存，不能被當成活躍區段或髮長。
- 零長、最短殘茬、Lmax、無效輸入／NaN 處理須有明確結果。保留 root 資料可重新生長。
- Constraint 以 strand ID＋s interval＋owner 管理；同段互斥錨點拒絕／預覽解除。長度不足不能自行伸長補足。
- Undo/Redo 為可序列化資料指令；至少 20 步，重啟仍有效。動態物理快照不是編輯歷史。
- canonical hash 用於規範化永久資料；跨平台測語義及容差，不要求 GPU 像素或物理浮點逐位一致。

## 實作前仍須完成的設計

1. 弧長取樣器、連續局部座標框架及捲曲邊界過渡。
2. 已變形／受約束曲線切口到材料 s 的映射；渲染子髮和 Guide 的編輯粒度。
3. 剪短後再 Curl/Comb 對下游舊幾何的失效／重建政策；先提供測試案例再實作。
4. 髮長上限、最短殘茬、碰撞容差及典型髮量由 spike 量測後確認，不捏造現成數值。
