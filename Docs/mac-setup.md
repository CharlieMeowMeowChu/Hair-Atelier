# Mac 接續設定（必須由擁有人登入的部分）

已確認：擁有人有 Mac，尚未設定 Unity。未取得 macOS 版本、Apple Silicon/Intel 資料，亦未建立遠端控制；本回合沒有在該 Mac 執行指令。

1. 在 Mac「關於這台 Mac」確認晶片及 macOS 版本；記錄 iPhone/iPad 的實際 OS。毋須提供裝置序號。
2. 從 https://unity.com/download 安裝官方 Unity Hub。由擁有人親自登入並選擇符合資格的 Unity 授權及接受條款；不要把帳密、序號、授權檔貼在聊天或 Public Repo。若顯示需付費，先停下確認，不能假定免費方案資格。
3. 安裝 **Unity 6000.3.27f1** 對應 Mac 架構，加入 iOS Build Support。安裝來源及 build ID 以官方發行資料核對。
4. 按 Mac/macOS 與真機 OS，從 Apple 官方安裝相容 Xcode，開啟完成必要元件設定。Apple 條款及帳戶登入由擁有人處理。
5. Clone 此 Repo；切到經審核的 Phase 0 分支。Phase 1 尚未實作，現在 Repo 沒有 UnityProject，不能直接打開成遊戲。
6. Phase 1 才建立 URP 專案，解析並鎖定套件；先跑 Editor/EditMode/PlayMode 及桌面空殼，再產生 Xcode 專案並簽章至兩部真機。Simulator 不能代替髮絲效能真機證據。

設定完成後只需回報 macOS、晶片、Unity 版本、是否啟用成功，以及裝置 OS；失敗可提供已遮去帳戶／識別資料的錯誤文字。需要工程師協助可另建立受控執行連線，不預設聊天能直接操作該 Mac。

來源：
- Unity iOS setup：https://docs.unity3d.com/6000.3/Documentation/Manual/ios-environment-setup.html
- Apple Xcode 相容表：https://developer.apple.com/support/xcode/

本清單不要求購買 Apple Developer Program、不建立付費雲端服務、不上架遊戲。
