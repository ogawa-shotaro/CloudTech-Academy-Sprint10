# DLQ(失敗メッセージ)の確認・再処理手順

対象: `sales-report-automation-notification-dlq`

## 1. DLQにメッセージが滞留していないか確認する

SQSコンソールで `sales-report-automation-notification-dlq` を開き、「メッセージ利用可能数(Messages available)」が1件以上になっていないか確認する。

AWS CLI/APIで確認する場合:
```
GetQueueAttributes(QueueUrl=<DLQのURL>, AttributeNames=["ApproximateNumberOfMessages"])
```

## 2. メッセージの中身を確認する

1. DLQを開き、「メッセージを送受信(Send and receive messages)」→「メッセージをポーリング(Poll for messages)」
2. 表示されたメッセージをクリックし、本文(`reportBucket`, `reportKey`, `reportSummary`, `generatedAt`)を確認する
3. 併せて、`EmailSenderFunction`のCloudWatch Logsで同時刻帯のエラーログを確認し、失敗原因(SESの検証エラー、一時的な障害など)を特定する

## 3. 原因を解消する

よくある原因と対処:

| 原因 | 対処 |
|---|---|
| 宛先/送信元メールアドレスがSESで未検証 | SESコンソールでメールアドレスを検証する(確認メールのリンクをクリック) |
| `RECIPIENT_EMAILS`環境変数の設定ミス | `EmailSenderFunction`の環境変数を修正する |
| SESの一時的な障害・スロットリング | 時間を置いて再処理する(下記手順4) |

## 4. DLQのメッセージを元のキューへ再投入する(Redrive)

1. SQSコンソールでDLQを開き、「DLQ の再処理を開始(Start DLQ redrive)」をクリック
2. 「移動先(Redrive to)」で「元のソースキュー(Source queue(s))」を選択
3. 「DLQ の再処理を開始」を実行
4. 数秒〜数分後、`sales-report-automation-notification-queue`にメッセージが戻り、`EmailSenderFunction`が自動的に再処理する
5. `EmailSenderFunction`のCloudWatch Logsで、エラーなく処理が完了した(`END`/`REPORT`のみでERRORが出ていない)ことを確認する
6. 関係者にメールが届いたことを確認する

## 5. 再処理後の確認

- メインキュー・DLQとも メッセージ数が0件に戻っていることを確認する(`GetQueueAttributes`)
