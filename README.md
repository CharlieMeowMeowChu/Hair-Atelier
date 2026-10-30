# Realistic Hair Studio / Hair Atelier

目前為 **Web Phase 1–2 技術樣板**。核心玩法只會在可操作、可測試的 Three.js 樣板中逐項驗證；不把畫面當成已完成功能。

唯一正式產品規格：[`HairStudio_AI_Development_Masterplan_zh-HK.md`](HairStudio_AI_Development_Masterplan_zh-HK.md)（1.2）。擁有人明確決定保持本 Repo **Public**；照片、秘密及簽章不放 Repo。決策見 [DECISIONS.md](DECISIONS.md)。

## Web 技術樣板

在 repo 根目錄：

```bash
nvm use
npm ci
npm run check
npm run check:browser
npm run dev
```

`npm run check` 執行核心不變條件測試、Service Worker 與 PWA shell 檢查、TypeScript production build，以及 production JS bundle 預算檢查（單一最大 bundle 上限 600 KB／gzip 150 KB）。瀏覽器開啟後可拖動旋轉，並可對 C 髮束執行「捲 C → 剪 C 到一半 → C 增長 → Undo」。畫面把 4 條 GuideStrand 衍生成最小 3D ribbon；未代表全頭髮、真人資產、精確剪刀拾取或真機效能已完成。

目前核心使用 schema v2：`length` 與沿束 `s` 均為以米量度的 Rest centerline material arc length。舊 v1 state／history 讀取時會明確遷移；耳後、綁紮及辮子仍屬衍生 pose constraint。詳細邊界見 [拾取與約束契約](Docs/pick-and-constraint-contract.md)。

GitHub Actions 在 push 與 PR 使用 `.nvmrc` 的 Node.js 24.19.0 重跑 `npm ci` 與 `npm run check`。

`npm run check:browser` 只在已安裝 Chromium 的開發環境執行，會以 DevTools Protocol 檢查 canvas、overlay 及 page error；它不取代 Safari 真機驗收，因此不放入 GitHub Actions。

PWA manifest 與 service worker 已建立。此 PR 的既有 Vercel integration 會自動產生受 SSO 保護的 Preview；沒有手動部署、production release 或公開 Safari Gate 網址。請用 iPhone 16 Pro Max 及 iPad A16 的 Safari 作後續真機驗證，不能用桌面結果取代。

下一步工作單：[Phase 1–2](Docs/phase1-2-work-orders.md)。所有修改經分支及 PR；不自動 merge、不發佈遊戲。
