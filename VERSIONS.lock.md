# 工具版本／驗證狀態

> 2026-10-26：Unity 技術路徑已被 TypeScript＋Three.js Web App／PWA 取代。下列 Unity／Blender 紀錄只保留為已完成的環境歷史，不是當前依賴或 Gate 證據。

## 當前 Web 依賴

| 工具／套件 | 鎖定來源 | 狀態 |
|---|---|---|
| Node.js | 24.19.0（`.nvmrc`、`package.json` engines、GitHub Actions） | 實測 `npm run check`；CI 使用同一精確版本 |
| TypeScript | package-lock.json | production typecheck／build PASS |
| Three.js | package-lock.json | Three.js WebGL 技術樣板已使用 |
| Vite | package-lock.json | production build PASS |
| Vitest | package-lock.json | 57 項 core／手勢／效能／Rest arc／ribbon tests PASS |
| Safari iPhone 16 Pro Max／iPad A16 | 待真機實測 | 未測，不能由桌面代替 |

## 已淘汰路徑的歷史紀錄

日期：2026-10-26（香港）。本檔鎖定環境選擇，尚不是已可建置遊戲的套件鎖檔。

| 工具 | 精確版本／來源 | 狀態 |
|---|---|---|
| Unity Editor Linux x86_64 | 6000.3.27f1；官方 build 672d562a42a7 | 已安裝，官方 integrity／版本執行 PASS；空專案 BLOCKED_LICENSE |
| Unity 發行 API | https://services.api.unity.com/unity/editor/release/v1/releases?version=6000.3.27f1 | 本次實際查詢；2026-10-20 發行 |
| Unity release notes | https://unity.com/releases/editor/whats-new/6000.3.27f1 | 已知問題需在 Phase 1 建置驗證，不宣稱相容通過 |
| Blender | 4.3.2；既有 /usr/bin/blender | headless GLB round-trip PASS；固定目前測試版，未自動升級 |
| Git | 2.52.0 | 實際執行版本及 clone 成功 |
| Git LFS | 3.6.1 | 實際執行，repo local 初始化完成；未上傳二進制 |
| Unity 所附 Mono | 6.13.0；Editor 內建 runtime/compiler | standalone C# compile/execute PASS；不是 Unity 專案驗證 |
| Python | 3.12.14 | 環境檢查工具執行成功；僅開發工具 |
| URP | 待 Phase 1 實際專案相容解析 | 未安裝，不虛構 patch |
| Input System | 待 Phase 1 實際專案相容解析 | 未安裝 |
| Unity Test Framework | 待 Phase 1 實際專案相容解析 | 未安裝 |
| Xcode / macOS / iOS SDK | 未配置 | Apple build BLOCKED；需相容真機 OS 的 Mac 工具鏈 |
| Android SDK / NDK / JDK | 未配置 | 非本次第一批驗證裝置；保留原平台範圍 |

Unity 官方文件：https://docs.unity3d.com/6000.3/Documentation/Manual/ios-environment-setup.html 。Apple 工具鏈版本需依實際 Mac/macOS、真機 OS 及 Unity 建置實測選定，不以 Unity 最低 Xcode 版本當成可部署任何新 OS 的保證。

Unity 安裝位置為 /workspace/toolchains/unity-6000.3.27f1，位於 repo 外；不提交 Editor、cache 或授權檔。重跑 metadata／下載／校驗／解壓見 Tools/unity_setup.py，各步明確選用；不包含自動啟用。

套件鎖定條件：Phase 1 產生 Packages/manifest.json、packages-lock.json 及 ProjectVersion.txt，記錄實際解析版本並通過乾淨建置，才可標為驗證成功。
