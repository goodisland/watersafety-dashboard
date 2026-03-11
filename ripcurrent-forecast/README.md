# 日本版 離岸流予報 Webアプリ（プロトタイプ）

日本沿岸の海水浴場・海岸を対象に、6時間ごとの波浪データ（波高・周期・波向）から離岸流リスクを推定して表示する Web アプリです。

## できること
- 日本地図上で地点ごとの離岸流リスクを色分け表示
- 海岸名 / 海水浴場名 / 緯度経度 (`lat,lon`) で検索
- 6時間ごとの時系列予報をカード表示
- Mapbox スタイル切替（任意）
- Google Maps への地点リンク

## ファイル構成
- `index.html`: UI レイアウト
- `styles.css`: 洗練系デザイン（グラデーション、ガラス表現）
- `app.js`: 検索・地図・リスク計算・描画ロジック
- `data/beaches-jp.json`: 海岸/海水浴場マスタ
- `data/gpv-sample.json`: GPV形式サンプル（6時間ステップ）
- `data/gpv-index.json`: 読み込むGPV JSONの一覧（この中で generatedAt が最新のファイルを採用）

## 起動
静的ファイルとして動作します。簡易サーバで実行してください。

### 例（PowerShell）
```powershell
cd C:\Users\goodi\Desktop\Files\05_MTG\260313_watersafety
python -m http.server 8080
```

ブラウザで `http://localhost:8080` を開きます。

## 実GPVデータへの接続
`data/gpv-sample.json` を、実データ生成処理で定期更新してください。

必要フォーマット:
```json
{
  "generatedAt": "2026-03-06T00:00:00+09:00",
  "timeStepHours": 6,
  "leadHours": [0,6,12,...],
  "cells": [
    {
      "lat": 35.30,
      "lon": 139.48,
      "waveHeightM": [1.2, ...],
      "wavePeriodS": [7.4, ...],
      "waveDirDeg": [150, ...]
    }
  ]
}
```

- `cells` は 5km メッシュ相当の格子点を想定
- アプリ側は各海岸に対して最近傍メッシュを自動選択

## リスク推定ロジック（暫定）
`app.js` の `calcRipScore()` は、次の3要素を 0〜1 に正規化して合成します。

### `clamp` とは
`clamp(x, 0, 1)` は、値 `x` を `0` 以上 `1` 以下に切り詰める関数です。

- `x < 0` のとき `0`
- `0 <= x <= 1` のとき `x`
- `x > 1` のとき `1`

数式では次のように表せます。

$
\mathrm{clamp}(x, 0, 1) = \min\left(1, \max\left(0, x\right)\right)
$

### 各要素の定義
1. 波高正規化
$
\mathrm{heightNorm} = \mathrm{clamp}\left(\frac{\mathrm{waveHeightM}-0.3}{3.0-0.3}, 0, 1\right)
$

2. 周期正規化
$
\mathrm{periodNorm} = \mathrm{clamp}\left(\frac{\mathrm{wavePeriodS}-4.0}{12.0-4.0}, 0, 1\right)
$

3. 入射方向一致度
$
\mathrm{diff} = \mathrm{angularDifferenceDeg}(\mathrm{waveDirDeg},\,\mathrm{shoreNormalDeg})
$
$
\mathrm{approach} = \mathrm{clamp}\left(\cos\left(\frac{\pi}{180}\cdot\mathrm{diff}\right), 0, 1\right)
$

### 最終スコア
$
\mathrm{score} = \mathrm{clamp}\left(0.45\cdot\mathrm{heightNorm} + 0.30\cdot\mathrm{periodNorm} + 0.25\cdot\mathrm{approach}, 0, 1\right)
$

`angularDifferenceDeg(a, b)` は角度差を `0〜180` 度に正規化した値です。海岸法線に近い入射ほど `approach` が大きくなります。

### リスク区分閾値
`scoreToLevel()` で次の4段階に変換します。

- `low`: `score <= 0.35`
- `moderate`: `0.35 < score <= 0.60`
- `high`: `0.60 < score <= 0.80`
- `extreme`: `score > 0.80`
## Mapbox 連携
`app.js` の `CONFIG.mapProvider` を設定:
- `mapboxToken`
- `mapboxStyle` (例: `mapbox://styles/mapbox/navigation-night-v1`)

設定後、UI の「地図プロバイダ」から `Mapbox Style URL` を選択します。

## Google Maps 連携
選択地点カードにある「Google Mapsで開く」で連携しています。

Google Maps JS API に完全統合したい場合は、別途 API キー設定と描画切替実装を追加してください（現状は MapLibre 表示が標準）。

## 注意
- 本実装は「予測支援の試作」であり、公式警報を代替するものではありません。
- 実運用時は、観測値での検証・係数チューニング・地形データ統合を実施してください。

## 最新JSONの選択ルール
`app.js` は `data/gpv-index.json` の `files` 配列を読み込み、各JSONの `generatedAt` を比較して最も新しいデータを採用します。

例:
```json
{
  "files": [
    "./data/gpv-20260306-00.json",
    "./data/gpv-20260306-06.json"
  ]
}
```

地図上のリスク表示は、この「最新JSON」の `leadHours[0]`（直近時刻）に基づいて表示されます。

