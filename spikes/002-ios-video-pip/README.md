# Spike 002 — iOS Safari システム PiP（通常 mp4）

## 目的

DQW を別アプリで開いたまま、**通常の mp4 を `<video>` 再生**し、Safari の**システム PiP**小窓に載せられるかを確認する。

- `canvas.captureStream` / `MediaStream` **不使用**
- 案A floating **不使用**
- 本体 `app/` **未変更**

## ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | video + 再生/PiP ボタン + ログ |
| `sample.mp4` | 6 秒・H.264 baseline + AAC（iOS 向け） |
| `README.md` | 本手順 |

## ローカル起動

Web リポジトリルートから:

```bash
cd C:\Users\shiny\Desktop\DQW-Memo
python -m http.server 8765
```

ブラウザで:

```
http://127.0.0.1:8765/spikes/002-ios-video-pip/
```

iPhone は同一 LAN の PC IP 例:

```
http://192.168.x.x:8765/spikes/002-ios-video-pip/
```

（GitHub Pages に上げる場合は `.../spikes/002-ios-video-pip/` を開く。**この Spike は commit 前のため Pages 未反映の可能性あり。**)

## 操作

1. **再生** — muted + playsinline で再生
2. **PiP 開始** — WebKit `webkitSetPresentationMode` または `requestPictureInPicture`
3. ホーム / **DQW アプリ**へ切替 — 小窓が残るか確認
4. 画面の meta / log に `readyState`, `videoWidth`, `videoHeight`, URL, エラーを記録

## 合格条件

- [ ] Desktop Chrome: 再生 OK、PiP OK（参考）
- [ ] iPhone Safari: `videoWidth > 0` で再生 OK
- [ ] iPhone: システム PiP 小窓が出る（mode / pictureInPictureElement 確認後の成功ログ）
- [ ] PiP 後に DQW を前面にしても小窓が残る

## 禁止事項

- captureStream / MediaStream
- HLS・サーバ生成・認証
- 本体統合・commit / push（検証完了と指示があるまで）
