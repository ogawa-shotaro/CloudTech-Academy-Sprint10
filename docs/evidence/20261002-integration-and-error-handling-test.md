# 結合テスト・異常系確認の証跡(2026-10-02)

AWSコンソールでの操作結果を、AWS MCP(boto3 API)経由で取得したレスポンスとCloudWatch Logsの実ログで記録する(スクリーンショットの代わり)。

## 正常系: エンドツーエンドのワークフロー実行

- Step Functions `SalesReportWorkflow` を入力 `{ "targetMonth": "2024-01" }` で手動実行
- 実行結果: 成功。`AggregateSales` → `GenerateReport` の両ステートが完了
- `GenerateReport`の出力(`reportSummary`):
  ```
  2024-01の売上レポートが作成されました。
  総売上: ¥1,900,000
  カテゴリ別内訳:
  - 電子機器: ¥1,450,000
  - 家具: ¥450,000
  ```
- S3(レポート保存バケット)に `reports/sales-report-2024-01.csv` が作成されたことを確認
- SQS(レポート通知キュー)経由でLambda(メール送信)が起動し、Gmailへのメール受信を確認

## 異常系: リトライとDLQ移動(要件8)

### 手順
1. `EmailSenderFunction`の環境変数`RECIPIENT_EMAILS`を未検証アドレス(`not-verified@example.com`)に一時変更
2. SQS(レポート通知キュー)へ手動でテストメッセージを送信
3. CloudWatch Logsで3回のリトライ失敗を確認:
   - `2026-10-02T04:32:00.478Z` エラー: `Email address is not verified...`
   - `2026-10-02T04:32:29.359Z` エラー: 同上
   - `2026-10-02T04:32:59.507Z` エラー: 同上
4. DLQ(`sales-report-automation-notification-dlq`)のメッセージ数が **1件** になったことをAWS MCP(`GetQueueAttributes`)で確認
5. 環境変数`RECIPIENT_EMAILS`を正しい検証済みアドレスに戻す
6. SQSコンソールの「DLQの再処理を開始(Start DLQ redrive)」で、DLQのメッセージを元のキューへ再投入
7. 再投入後、Lambdaの実行ログにエラーが出ず正常終了(`END`/`REPORT`のみ)したことを確認
8. メインキュー・DLQとも メッセージ数0件(正常に消費済み)
9. Gmailに再処理後のテストメールが届いたことを目視確認

### 結果

要件8の受け入れ条件をすべて満たすことを確認した:
- [x] メール送信失敗時に最大3回まで自動リトライされる
- [x] 3回のリトライ後、失敗したメッセージがDLQへ自動的に移動する
- [x] DLQのメッセージは削除されず保持され、内容を確認できる
- [x] DLQのメッセージを元のキューへ再投入して再処理できる
