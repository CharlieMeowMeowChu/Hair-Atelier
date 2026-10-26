# Realistic Hair Studio / Hair Atelier

目前為 **Web Phase 1–2 技術樣板**。核心玩法只會在可操作、可測試的 Three.js 樣板中逐項驗證；不把畫面當成已完成功能。

唯一正式產品規格：[`HairStudio_AI_Development_Masterplan_zh-HK.md`](HairStudio_AI_Development_Masterplan_zh-HK.md)（1.2）。擁有人明確決定保持本 Repo **Public**；照片、秘密及簽章不放 Repo。決策見 [DECISIONS.md](DECISIONS.md)。

## Web 技術樣板

在 repo 根目錄：

```bash
npm ci
npm run check
npm run dev
```

`npm run check` 執行核心不變條件測試，然後 TypeScript production build。瀏覽器開啟後可拖動旋轉，並可對 C 髮束執行「捲 C → 剪 C 到一半 → C 增長 → Undo」。這是 4 條 GuideStrand 的技術樣板，未代表全頭髮、真人資產、精確剪刀拾取或真機效能已完成。

PWA manifest 與 service worker 已建立；暫不部署。請用 iPhone 16 Pro Max 及 iPad A16 的 Safari 作後續真機驗證，不能用桌面結果取代。

下一步工作單：[Phase 1–2](Docs/phase1-2-work-orders.md)。所有修改經分支及 PR；不自動 merge、不發佈遊戲。
