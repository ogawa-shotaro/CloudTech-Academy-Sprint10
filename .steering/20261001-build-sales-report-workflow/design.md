# 設計書

本設計の詳細は`docs/architecture.md`および`docs/functional-design.md`に定義済みのため、ここでは「構築の進め方」に絞って記述する。

## アーキテクチャ概要

`docs/architecture.md`の構成をそのまま採用する。再掲:

```
EventBridge Scheduler(cron)
        │ 起動
        ▼
Step Functions(Standard)
        │
        ├─ Task: Lambda(売上集計)  ← S3(売上CSV)
        │
        └─ Task: Lambda(レポート作成) → S3(レポート保存)
                                      → SQS(レポート通知キュー)
                                              │ イベントソースマッピング
                                              ▼
                                      Lambda(メール送信) → SES
                                              │ 失敗時(maxReceiveCount超過)
                                              ▼
                                      SQS(DLQ)
```

## 構築順序の設計方針

AWSリソースには依存関係があるため、「依存される側から先に作る」順序で進める。

1. **S3・SQS(依存なしの基盤リソース)**: 他のリソースから参照されるだけなので最初に作る。SQSはDLQを先に作り、その後メインキューにDLQのARNを指定する
2. **SES検証**: Lambda(メール送信)の前提条件。並行して進めておける
3. **Lambda(売上集計)**: S3(売上CSV)にのみ依存
4. **Lambda(レポート作成)**: S3(レポート保存)とSQS(レポート通知キュー)に依存
5. **Lambda(メール送信)**: SES検証とSQS(レポート通知キュー)に依存
6. **Step Functions**: 2つのLambda(集計・レポート作成)に依存
7. **EventBridge Scheduler**: Step Functionsに依存
8. **結合テスト**: 全リソースが揃って初めて実施可能

## 各ステップでの進め方

`docs/CLAUDE.md`の方針に従い、1ステップずつ以下のサイクルで進める:

1. これから行う設定項目とその意味を解説する
2. 具体的な入力値(名前、設定値)を提示する
3. ユーザーが実際にコンソールで操作する
4. ユーザーから完了報告(またはスクリーンショット)を受け取る
5. `tasklist.md`の該当タスクを`[x]`に更新し、次のタスクに進む

## Lambdaコードの実装方針

- `docs/development-guidelines.md`のコーディング規約(ESM、モジュールスコープでのSDKクライアント初期化、エラーの握りつぶし禁止)に従う
- コードは`src/lambdas/[関数名]/index.mjs`に作成し、コンソールにはそこからコピー&ペースト、またはzip化してアップロードする
- 売上CSVの具体的なフォーマット(カラム定義・集計軸)は、Lambda(売上集計)の実装着手時にユーザーから提供を受けて確定する

## テスト戦略

`docs/functional-design.md`のテスト戦略をそのまま踏襲する:
- 単体確認: 各Lambdaをコンソールのテスト機能で個別実行
- 結合確認: S3にテスト用CSVを配置しStep Functionsを手動実行
- 異常系確認: メール送信を意図的に失敗させ、DLQへの移動を確認

## セキュリティ考慮事項

- 各IAMロールは`docs/architecture.md`で定義した最小権限のポリシーのみを付与する
- 作成の過程でうっかりワイルドカード(`*`)権限を選択しないよう、都度権限内容を確認する

## 将来の拡張性

- Post-MVPの機能(CSV自動連携、SES本番アクセス)は今回のスコープ外。`docs/product-requirements.md`に記載済みの内容を将来着手する際に参照する
