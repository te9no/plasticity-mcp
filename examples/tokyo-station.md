# 東京駅：専用MCPツールによる制作例

1,082部品の外観模型を、プリミティブ・材質・変形・ブーリアン・グループ操作で制作しました。任意スクリプト実行ツールや外部形状インポートは使いません。長さ約335 mmの概形で、測量図面や印刷用の一体形状ではありません。

## 再現手順

Plasticity 25.3.0で新しい検証専用ウィンドウを用意し、`native_windows` で対象IDを確認します。出力先 `models/tokyo-station` がまだ存在しない新しいチェックアウトで、ビルド後に以下を一度ずつ実行します。途中失敗時はシーンと復旧記録を確認し、同じ制作スクリプトをそのまま再実行しないでください。

```powershell
cd mcp-server
$env:PLASTICITY_TARGET = '検証専用ウィンドウのID'
node scripts/build-tokyo.mjs
node scripts/tokyo-connectors.mjs
node scripts/finish-tokyo.mjs
node scripts/verify-tokyo.mjs
```

出力はGit管理対象外の `models/tokyo-station/` に保存されます。完成ネイティブ形式は `tokyo-station-final.plasticity`、STEPは `tokyo-station.step`、OBJは `tokyo-station.obj` です。ログには絶対パスやウィンドウIDが含まれるため、共有前に確認してください。

保存・再読み込みで1,082部品の名前、材質、親グループが一致しました。再メッシュ化による境界の差は最大約0.02872 mmで、許容差0.05 mm以内でした。

形状の参考：[東京ステーションシティ](https://www.tokyostationcity.com/learning/station_building/)、[政府広報の駅舎紹介](https://www.gov-online.go.jp/hlj/ja/february_2025/february_2025-03.html)。参考写真は同梱していません。
