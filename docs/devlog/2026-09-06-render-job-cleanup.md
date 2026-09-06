# Render job cleanup

## 目的

server側の生成ジョブ蓄積をTTLで制限する。app、IndexedDB、PiP、ffmpeg設定は変更しない。

## 現状の問題・render-jobs構成

- ルート: `%LOCALAPPDATA%\DQW-Memo\render-jobs`。LOCALAPPDATA未設定時はホーム配下AppData/Local。
- jobId: ローカル日時 `YYYYMMDD-HHMMSS` + UUID4先頭12桁。
- ジョブ直下: `input.txt`（title + 空行 + content）、`generated.mp4`、`ffmpeg.log`。失敗段階によっては一部のみ。
- 従来は状態マーカーもcleanupもなく、再起動後も過去ファイルが残った。
- `/videos/<jobId>.mp4` はファイル全体を読み、video/mp4として送信する。

## TTL値と理由

`RENDER_JOB_TTL_SECONDS = 24 * 60 * 60`（24時間）。個人LAN利用で通常は直後に取得しIndexedDBへ保存するため長期保存は不要。一方で短時間の再試行・操作中断を許容する。

## cleanupタイミング・アルゴリズム

起動時とrender開始時に同期実行。タイマーなし。ジョブルート直下の正規jobId名ディレクトリだけを対象にする。symlink/junctionを除外し、解決後の絶対パスの親がルートであることを削除前に確認する。
mtimeが現在時刻-24時間より古い非activeディレクトリを全体削除。境界値・未来時刻のジョブは保持。未知の名前は保守的に保持する。

## active job保護・並行処理

ThreadingHTTPServerの並行requestに合わせ、active setとRLockを導入。ディレクトリ作成前に登録し、成功・失敗ともfinallyでmtimeを更新して登録解除する。長時間renderも実行中は保護され、完了後から保持期間を確保する。時刻更新失敗はログへ記録。
cleanupとactive登録/解除を同じロックで調停する。ffmpeg実行中はロックを保持しない。
MP4読込とstatも同じロック内で行い、削除とのraceを回避。HTTP送信は取得済みbytesを使いロック外で行う。削除済みファイルは既存404。

## cleanup失敗時の扱い

列挙時のOSErrorは記録して終了。個別のPermissionError、FileNotFoundError、部分削除などのOSErrorは記録し次の候補へ進む。render処理には伝播させない。失敗ジョブは次回cleanupで再判定する。

## 変更ファイル・実装内容

- `server/render_server.py`: TTL cleanup、active管理、配信時読込の排他。既存Windowsパスdocstringの構文警告もraw文字列化で解消。
- `tests/render_job_cleanup.py`: unittest、一時ディレクトリの実削除、実ffmpeg・HTTP検証。
- `docs/devlog/2026-09-06-render-job-cleanup.md`: 本記録。

## テスト結果

Windows / Python 3.12.14、実ffmpegを使用して12テストすべてPASS。

- 空、TTL未満保持、超過削除、混在時の選別。
- active超過保持、解除後削除可能、終了・失敗時の保持期間更新と登録解除。
- 並行スレッドのactive保護。
- 列挙後の実削除とFileNotFoundError、PermissionError時の継続、列挙失敗。
- 未知ディレクトリ保持、junction除外（判定を模擬）。
- 起動時cleanup（mainのHTTP serverのみモック）、request開始時cleanup。
- 削除失敗を注入した実POSTが200、正常renderから実MP4取得が200、取得bytesと生成物一致。
- cleanup済み旧URLは404。
- レスポンスのキー集合を検証。H.264 High/yuv420p/AAC/faststart/640x360/30fps/4秒のコマンドを確認。差分上もffmpeg引数変更なし。
- Python AST構文確認とgit diff --check PASS。

再現: Python 3.12以上で `python -B tests/render_job_cleanup.py`。FFMPEG環境変数に実行ファイルを指定可能。既存のNotoSansJP-VF.ttfが必要。一時ジョブルートを用い、実利用ジョブには触れない。

## 失敗・切り分け

制限環境で最初の実HTTP検証は500。実行権限を許可した同一テストは成功。最終12件は全PASS。テスト時のcleanup失敗ログは意図的な障害注入。

## 実機確認

2026-09-07、ユーザーによるiPhone Safari / DQW実機回帰のPASS報告を受領。Codex自身が実機操作を再実行したものではない。

- 新規内容「テスト5 / あ か さ」でCACHE MISS。
- render API成功、MP4取得成功、動画準備完了。
- WebKit PiP開始成功、DQW上で正常表示。
- 日本語・改行正常。
- 同じ内容の再準備でCACHE HIT、再生成なし、「キャッシュから準備完了」を確認。

通常MISS経路および既存CACHE HIT経路に実機上の回帰なし。PiP中の一覧遷移・別メモ準備・PiP終了待ちからの切替は、今回の結果報告には含まれていないため追加のPASSとは記録しない。TTL超過の削除や障害注入は上記Desktopテストで確認。

## Git状態

開始時main/ origin/main: `f37f0df9e1a1612b17e3bd4f0f5e56389a24e9b0`。
実装・Desktop検証報告時点では3ファイルのみ変更・追加、commit/push未実施。2026-09-07の実機PASS報告後、ユーザーからこの3ファイルのcommit・通常pushの承認を受領。commit messageは `feat: clean up expired render jobs`。確定SHAはGit履歴を参照。
`spikes/003-ffmpeg-memo-video/generated.mp4` は未追跡のまま保持し、変更・削除しない。

## 次の課題・制限

- 実機回帰PASS、commit・通常push承認済み。追加実装は行わない。
- active保護は単一serverプロセス内。複数serverプロセスで同じルートを共有する運用は対象外。
- 起動/requestがなければTTL経過直後には削除されない。容量上限・常時timerは今回対象外。
- 大量ジョブの同期削除中は他requestの登録・MP4読込が待つ可能性がある。
- Python 3.12のPath.is_junctionを使用。異なるPython環境は未検証。
