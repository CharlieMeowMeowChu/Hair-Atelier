# Phase 0 實際驗證紀錄

日期：2026-10-26（香港）。基準 main：db65f6b54120bb7c682cc8f3ecd6ff2315d2f5ef。分支：phase0/environment-readiness。

## 實際結果

| 驗證 | 結果 | 證據 |
|---|---|---|
| 官方 Unity metadata | PASS | unity-metadata.log；官方 API 精確 6000.3.27f1 |
| Unity 下載完整性 | PASS | unity-download.json；4,573,113,148 bytes，官方 MD5 相符，另計 SHA-256 |
| Editor 解壓與版本執行 | PASS | unity-version.log；-version exit 0，6000.3.27f1 |
| C# 編譯及執行 | PASS | csharp-smoke.json；compile exit 0、execute exit 0，UTF-8 file round-trip |
| Blender headless／米制 GLB 匯出再匯入 | PASS | blender-smoke.json/.log；5 項檢查、最大尺寸誤差 0m，exit 0 |
| Repo 規格 hash 及規劃文件檢查 | PASS | environment.json；原規格 SHA-256 8b49e95d73e497ccc16001d98b7e0beb4deb005f7d969a6709a75bc21fad9da3 |
| Python 工具語法 | PASS | python -m py_compile Tools/*.py，exit 0 |
| Unity 臨時空專案 | BLOCKED_LICENSE | unity-batch.json；Editor exit 198：No valid Unity Editor license found |
| Unity 專案編譯、EditMode/PlayMode、URP | NOT_TESTED | 沒有遊戲專案／有效授權；不可標成功 |
| Apple 真機建置及效能 | BLOCKED | 工作環境非 Mac；擁有人有 Mac 尚未設定 Unity，尚未接入／測試 |
| F01–F18、HAIR-001–034 | NOT_STARTED | 本次沒有遊戲實作，不把環境測試當成產品功能 |

Unity 所附 Mono 6.13.0／C# compiler 的 standalone smoke，不調用 UnityEngine，不能證明 Unity 專案可編譯。Unity 授權錯誤是實際阻塞；無付費、無代登入／接受條款、無變更系統網絡或公開部署。

## 重跑命令

在 repo 根目錄：

```bash
python Tools/unity_setup.py --directory /workspace/toolchains --probe
python Tools/check_environment.py --unity /workspace/toolchains/unity-6000.3.27f1/Editor/Unity --output BuildReports/phase0/environment.json
python Tools/csharp_smoke.py --editor /workspace/toolchains/unity-6000.3.27f1/Editor --output BuildReports/phase0/csharp-smoke.json
blender --background --factory-startup --python-exit-code 1 --python Tools/blender_smoke.py -- BuildReports/phase0/generated
python Tools/unity_project_smoke.py --unity /workspace/toolchains/unity-6000.3.27f1/Editor/Unity --output BuildReports/phase0/unity-batch.json
python -m py_compile Tools/*.py
git diff --exit-code db65f6b54120bb7c682cc8f3ecd6ff2315d2f5ef -- HairStudio_AI_Development_Masterplan_zh-HK.md unimportant_test.txt
```

`unity_project_smoke.py` 因授權阻塞回傳 2（其啟動的 Editor 回傳 198），不是測試成功。環境檢查器的 NOT_TESTED 指產品 build，實際空專案嘗試另見 unity-batch.json。

首次下載／完整性校驗可用 `unity_setup.py --directory <repo外路徑> --download`，解壓另加 `--extract`；本次實際解壓使用 `tar -xJf`，Python extract 選項尚未獨立驗證。所有安裝包與 Editor 放 repo 外；原始 licensing log 未上傳，只保留去除識別資料的診斷。

## Gate 0 狀態及接續

Phase 0 文件、環境安裝及可獨立 smoke 已交付；整體開發環境仍受 Unity 授權及 Mac 設定阻塞，不能宣稱 Gate 1/2 通過或 iPhone build 可用。規格保持原檔，Public 覆寫決策單獨記錄。Mac 接續步驟見 Docs/mac-setup.md；下一工作為完成授權／Mac 環境確認，再於獲批准 Phase 1 後建立最小 URP 專案。
