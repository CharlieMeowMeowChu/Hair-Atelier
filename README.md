# Realistic Hair Studio / Hair Atelier

目前為 **Phase 0 開發環境準備**，沒有可玩遊戲或已通過的 HAIR 功能測試。

唯一正式產品規格：[`HairStudio_AI_Development_Masterplan_zh-HK.md`](HairStudio_AI_Development_Masterplan_zh-HK.md)（1.1）。擁有人明確決定保持本 Repo **Public**；照片、秘密及簽章不放 Repo。決策見 [DECISIONS.md](DECISIONS.md)。

## 可重跑的環境驗證

在 repo 根目錄，Python 3.12 及 Blender 4.3.2：

```bash
python Tools/check_environment.py --unity /workspace/toolchains/unity-6000.3.27f1/Editor/Unity --output BuildReports/phase0/environment.json
blender --background --factory-startup --python-exit-code 1 --python Tools/blender_smoke.py -- BuildReports/phase0/generated
```

Blender smoke 建立 20cm 測試立方體，匯出／匯入 GLB 再比較米制尺寸；不含人物、相片或頭髮演算法。生成檔案被 gitignore 排除。結果見 [Phase 0 驗證紀錄](BuildReports/phase0/verification.md)。

Unity 安裝／探測程序見 [Tools/unity_setup.py](Tools/unity_setup.py)，版本與阻塞見 [VERSIONS.lock.md](VERSIONS.lock.md)。授權未就緒不能宣稱可編譯遊戲。

已安裝的 Editor 可回傳版本、獨立 C# 編譯／執行已成功；Unity 空專案啟動因缺有效授權被阻塞。Mac 接續見 [設定步驟](Docs/mac-setup.md)。

下一步工作單：[Phase 1–2](Docs/phase1-2-work-orders.md)。所有修改經分支及 PR；本次不改原規格、不自動 merge、不發佈遊戲。
