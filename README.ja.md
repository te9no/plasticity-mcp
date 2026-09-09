# Plasticity MCP 1.0（Windows / Plasticity 25.3.0）

Plasticity 25.3.0 の実行中アプリを、MCPから操作するサーバーです。
既存の [ozymandi/PlasticityMCP](https://github.com/ozymandi/PlasticityMCP) に、Electronのデバッグ接続を使う操作経路を追加しました。
本体ファイルの改造・入れ替えは行っていません。公式APIではないため、別バージョンでの動作は未確認です。

導入・対応範囲・復旧手順・検証結果は [1.0リリースノート](docs/RELEASE-1.0.md) を参照してください。リポジトリ直下の `./setup.ps1` で導入できます。

## 動作確認した機能

| ツール | 内容 |
|---|---|
| `native_windows` / `native_connect` | ウィンドウを一覧表示し、対象をIDで指定して接続 |
| `native_scene` | 形状ID、名前、種類、メッシュ由来の概略バウンディングボックス、単位設定、Undo状態 |
| `native_recover` | 結果不明の操作後、状態確認と処理の終了確認を経て編集を再開 |
| `native_save_copy` | 新しい `.plasticity` ファイルへコピー保存。既存ファイルは上書きしない |
| `native_rename` | 安定IDで部品名を変更。Undo/Redo対応 |
| `native_materials` / `native_set_material` | 材質の一覧、色・粗さ・金属度の作成、部品への割り当て |
| `native_group` / `native_visibility` / `native_delete` | グループ作成、表示切り替え、指定部品の削除。Undo/Redo対応 |
| `native_view` | カメラ方向・投影方法・全体表示・材質色・エッジ表示 |
| `native_open_document` | 指紋確認とバックアップ保存後にネイティブ文書を読み込む |
| `native_create_primitives` | 最大100個の名前・材質付き形状を1つのUndo単位で作成 |
| `native_create_primitive` | CADソリッドの球・箱・Z軸方向の円柱 |
| `native_move` | 形状の平行移動 |
| `native_rotate` | 指定した中心点・軸のまわりに回転（角度は度） |
| `native_scale` | 指定した中心点を基準にXYZ方向へ拡大縮小（倍率は正数） |
| `native_export_step` / `native_import_step` | CAD形状のSTEP入出力。書き出しは上書き禁止、読み込みは現在の文書へ追加 |
| `native_sketch_curve` | 点列から線・ポリライン・閉じた輪郭・補間スプラインを作成 |
| `native_sketch_circle` | 中心・半径・平面の法線を指定して円を作成 |
| `native_sketch_solve` | 水平・垂直・一致・距離・固定点の2D拘束計算。アプリは変更しない |
| `native_sketch_constrained` | 拘束を解いてポリラインを作成。`replaceId` 指定で既存のWireを再生成 |
| `native_export_iges` / `native_import_iges` | STEPとローカルOpen CASCADEを経由したIGES入出力 |
| `native_topology` | 現在の面・エッジID |
| `native_extrude_faces` | 面を法線方向に押し出して新しい形状を作成 |
| `native_fillet` | エッジの一定半径フィレット |
| `native_boolean` | ブーリアン演算（和・差・積を実機検証済み） |
| `native_select` | 形状の選択 |
| `native_undo` / `native_redo` | 通常のUndo/Redo |
| `native_export_obj` | ビューポートの三角形メッシュをOBJへ書き出す。既存ファイルは上書きしない |
| `native_screenshot` | 接続したウィンドウの画像を取得 |
| `native_capabilities` | 内部のFactory・Command名を一覧表示 |
| `native_execute_script` | `editor` と指定した内部クラスを使う高度なJavaScript操作 |

**長さ・座標の入力はメートルです。** 10 mm は `0.01`。画面の表示単位をmmへ変えても入力単位は変わりません。
OBJ座標もメートルです。CADの面そのものではなく、現在の表示用メッシュを書き出します。
面・エッジIDは編集で変化するため、編集後は `native_topology` を再取得してください。

## 起動

Node.js 22以降を使います。

```powershell
cd mcp-server
npm ci --ignore-scripts
npm run build
node dist/index.js
```

`node dist/index.js` はMCPクライアントが標準入出力で起動するプログラムです。
通常ログは標準エラーへ出力されます。

Plasticityには `http://127.0.0.1:9223` のデバッグ接続が必要です。
未起動の環境では、保存してアプリを終了した後、実際のインストール先を指定して起動します。

```powershell
& 'C:\実際のインストール先\Plasticity.exe' --remote-debugging-port=9223 --remote-debugging-address=127.0.0.1
```

既存アプリは自動終了・再起動しません。接続先は `PLASTICITY_CDP_URL` で変更できます（ローカルHTTPのみ）。

## MCPクライアントへの登録

MCPクライアントには、生成された `mcp-client.json` を参考に登録します。次の例では、次の `args` を実際の絶対パスへ変更してください。

```json
{
  "mcpServers": {
    "plasticity": {
      "command": "node",
      "args": ["C:/実際の作業フォルダ/plasticity-mcp/mcp-server/dist/index.js"],
      "env": {"PLASTICITY_CDP_URL": "http://127.0.0.1:9223"}
    }
  }
}
```

Codex CLIでの登録方法は [公式ドキュメント](https://learn.chatgpt.com/docs/developer-commands#codex-mcp) を参照。
接続後は `native_windows` → 対象の `targetId` で `native_connect` → `native_scene` の順に呼び出します。
名前が同じウィンドウでもIDで区別します。

例：`native_create_primitive` の引数

```json
{"shape":"box","origin":[0,0,0],"size":[0.03,0.02,0.01]}
```

30 × 20 × 10 mmの箱を作ります。形状の作成・移動・回転・拡大縮小・フィレット・押し出し・ブーリアン・STEP読み込みはPlasticityのコマンド処理を通し、Undo履歴へ登録されます。

例：IDが `12` の形状を、原点を中心にZ軸まわりへ90度回転します。

```json
{"ids":[12],"pivot":[0,0,0],"axis":[0,0,1],"angleDegrees":90}
```

STEP出力は `{"ids":[12],"path":"C:/Models/part.step"}`、読み込みは `{"path":"C:/Models/part.step"}` です。IDは必ず実際の `native_scene` から取得してください。

## スケッチと拘束

`native_sketch_curve` は `kind: "polyline"` または `"spline"`、3Dの `points`、省略可能な `closed` を受け取ります。ポリラインの2点指定が直線です。閉じる場合は末尾に先頭点を重複させず `closed: true` を指定します。円は `center`・`normal`・`radius` を指定します。

拘束は **MCP側で計算し、結果の形状をPlasticityへ反映する方式** です。Plasticityへ常時有効な拘束や履歴ツリーを追加するものではありません。返される `recipe` をJSONとして保存し、寸法を変更して `replaceId` とともに再実行すると、同じ形状IDで再生成できます。手動編集した形状から拘束を逆算する機能はありません。

[examples/constrained-rectangle.json](examples/constrained-rectangle.json) を `native_sketch_constrained` に渡すと、水平・垂直・距離・固定点を満たす30 × 20 mmの輪郭を作成します。

| 拘束の `type` | 引数 |
|---|---|
| `horizontal` | 点番号 `a`, `b` のY座標を一致 |
| `vertical` | 点番号 `a`, `b` のX座標を一致 |
| `coincident` | 点番号 `a`, `b` の位置を一致 |
| `distance` | 点番号 `a`, `b` と長さ `value`（m） |
| `fixed` | 点番号 `point` と固定座標 `at: [x,y]` |

点番号は0始まりで、座標は指定した平面内の2D座標です。`plane` は `XY`（既定）・`XZ`・`YZ`、`origin` はワールド座標です。最大64点・128拘束、許容残差は `1e-8` mです。自由な寸法は初期点列に近い解になります。`satisfied` は指定条件を満たす意味で、完全拘束の判定ではありません。矛盾や収束失敗は形状を作成する前にエラーにします。接線・平行・角度・円への拘束は未対応です。

## IGES変換環境

変換用Python環境はリポジトリ直下で以下を実行して作成します。

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install --only-binary=:all: -r mcp-server/scripts/requirements-cad.txt
```

既存のPython環境を使う場合は `PLASTICITY_CAD_PYTHON` にPython実行ファイルの絶対パスを設定できます。

本体のIGES出力はこの実機ではエラーになったため、STEPの入出力と [Open CASCADEのPythonバインディング](https://github.com/CadQuery/OCP) で変換しています。すべてローカルで処理します。本体のIGES対応は [公式のStudio機能](https://www.plasticity.xyz/) です。このMCPの変換経路は独立した変換ソフトを使います。

IGESは `.iges` / `.igs` を指定します。箱の往復で寸法とUndo/Redoを検証済みです。形状変換が対象で、アセンブリ・色・名前などの保持は保証しません。データによっては複数の面として読み込まれます。

## 検証

```powershell
cd mcp-server
npm run build
npm test
npm run doctor
```

実機テストは **新しく開いた検証専用ウィンドウ** のIDを指定します。形状を作成するため、編集中のモデルでは実行しないでください。

```powershell
$env:PLASTICITY_TARGET='native_windowsで取得した検証用ID'
npm run smoke:native
npm run smoke:detail
npm run smoke:exchange
npm run smoke:sketch
npm run smoke:constraints
npm run smoke:recovery
npm run smoke:document
```

`smoke:native` は本物のMCP stdioクライアントを通して実行し、`artifacts/` へOBJ・画像・結果JSONを出力します。
`smoke:detail` は面とエッジの取得、押し出し、フィレット、古いエッジIDの拒否を検証します。
`smoke:exchange` は原点以外を中心にした回転・非等方スケール、STEP往復の寸法一致、Undo/Redo、上書き拒否をMCP経由で検証し、STEPと結果JSONを出力します。
`smoke:sketch` は閉じた輪郭・傾けた円・スプラインと、IGESの往復寸法・上書き拒否を検証します。
`smoke:constraints` はMCP経由で拘束計算、XZ平面への作図、30 mmから50 mmへの寸法変更、同じIDでの再生成、Undo/Redo、矛盾した拘束で文書が変わらないことを検証します。

## 切断・タイムアウトからの復旧

編集要求の応答が失われると、そのウィンドウの編集を停止します。操作前に復旧記録をディスクへ保存し、MCPサーバーの強制終了や再起動後も停止を保持します。`native_scene`・`native_topology`・スクリーンショットで状況を確認できます。

1. 切断時は `native_windows` で対象を確認し、同じ `targetId` に `native_connect`。
2. `native_scene` の形状とUndo状態を確認します。失敗した要求をそのまま繰り返さないでください。
3. 返された `recovery.operationId` と `fingerprint` を `native_recover` に渡します。

シーンが変化した場合、Plasticityが操作中の場合、前の非同期処理の終了が確認できない場合は復旧を拒否します。復旧は操作の再実行やUndoを行いません。MCPエラーは `error.code` と `error.message` を持つJSONで返します。主なコードは `OUTCOME_UNKNOWN`・`RECOVERY_REQUIRED`・`OPERATION_PENDING` です。

**保護と制約:** 同一レンダラーへの複数MCP接続の書き込みを排他制御し、文書のクリア／読み込みを検出します。文書が変わった場合は明示的な再接続が必要です。GUI操作との同時編集や、awaitしない任意スクリプトの処理は保証対象外です。詳細はリリースノートを参照してください。

## 保存と部品名

`native_save_copy` に `{"path":"C:/Models/model-copy.plasticity"}` を渡すと本体の保存処理でコピーを作成します。現在の文書名や保存先は切り替えません。専用の一時フォルダーで保存し、既存ファイルを上書きしない形で指定先へコピーします。

`native_rename` は `{"id":12,"name":"前髪"}` のように指定します。部品名変更、Undo/Redo、コピー保存、重複保存拒否、保存前後の形状・履歴不変を実機MCPで検証しました。保存ファイルを再オープンし、形状・材質・グループの復元も検証済みです。

## 現在の範囲

- 動作確認日：2026-09-09、Windows、Plasticity 25.3.0。
- 通信先が切れたり操作がタイムアウトした場合、処理済みか不明になることがあります。上記の復旧手順を使用してください。書き込み操作を自動再試行しません。
- `native_execute_script` はアプリ内で実行され、サンドボックスや自動Undoはありません。内部クラスが存在しても、任意の操作の動作を保証するものではありません。
- 常時追従するネイティブ拘束、接線・角度などの追加拘束は対応範囲外です。カメラ・材質・グループ・表示切り替え・削除・バックアップ付き読み込みは専用ツールで対応しています。シーン一覧は安定IDを持つ幾何オブジェクトが対象で、自動生成されるスケッチ領域・補助ワイヤは含めません。グループ・インスタンスの完全な階層表現は未実装です。
- 元のBlender bridge経由ツールは `PLASTICITY_ENABLE_BRIDGE_TOOLS=1` で表示できます。検証環境では8980のサーバーが無効のため、実機検証していません。
- 上流のライセンスは未指定です。本リポジトリは上流の履歴を保持するGitHubフォークで、独自の再ライセンスは行いません。npm公開は無効にしています。

内部接続の仕組みは [docs/native-runtime.md](docs/native-runtime.md) を参照。
