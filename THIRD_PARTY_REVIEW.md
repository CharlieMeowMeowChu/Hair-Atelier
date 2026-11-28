# 第三方狀態

## 現行 Web 依賴

| 項目 | 固定來源 | 授權／決定 |
|---|---|---|
| three | package-lock.json（npm `three` 0.180.0） | MIT；已讀取安裝套件 `LICENSE` 原文。只用作 WebGL scene／line renderer，不提供剪髮資料真相。保留原版權及 license。 |
| Vite | package-lock.json | 開發 server／production bundler；不屬 runtime 髮絲演算法。 |
| Vitest | package-lock.json | 核心資料不變條件測試；不屬玩家 runtime。 |

本次無導入第三方 Hair 外掛、角色素材或模型。

Unity Editor：從官方 release API 取得精確 6000.3.27f1 Linux x86_64 URL 及 integrity，下載／驗證狀態見 BuildReports/phase0。此路徑已淘汰，不隨 Repo 分發或繼續研究。

Blender：使用環境已有 4.3.2，執行本專案自行撰寫的環境 smoke；未複製 Blender 程式進遊戲。Python 標準庫環境工具不增加 runtime 依賴。

Unity Demo Team Hair、Splines、glTFast 都未安裝，且不再是候選。將來任何額外 Web／hair 依賴仍須依規格 8.2 審閱完整 license、固定版本、依賴、來源及 Safari 實測；研究候選不能標為已批准依賴。
