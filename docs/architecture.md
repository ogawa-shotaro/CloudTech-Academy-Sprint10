# AWSアーキテクチャ設計書 (Architecture Design Document)

## リージョン

**ap-northeast-1(東京)**

- 対象サービス(EventBridge Scheduler, Step Functions, Lambda, S3, SQS, SES)はすべて東京リージョンで利用可能
- EventBridge Schedulerのタイムゾーン指定(`Asia/Tokyo`)はどのリージョンでも使えるグローバル機能であり、これ自体は東京リージョンを選ぶ理由にはならない
- 東京リージョンを選ぶ本質的な理由は以下の通り:
  - **SESの送信レピュテーション・バウンス処理を国内で完結させたい**: 送信元・宛先とも国内の関係者であるため、送信ドメインの評判管理やバウンス/苦情通知の扱いを日本国内リージョンに閉じておきたい
  - **データ所在地(データレジデンシー)**: 売上データという社内機微情報を国外リージョンに置きたくないという要件が一般的に想定される
  - **運用者のレイテンシ**: コンソール操作やログ確認を行う運用担当者が日本国内にいるため、体感レイテンシが小さい
- 一方で、コスト面ではus-east-1(バージニア北部)の方が安価なサービスもあるため、「東京である必然性」は上記の非コスト要因によるものであるという前提を意識しておく

## 命名規則

すべてのリソース名に `sales-report-automation-` プレフィックスを付与する(S3バケット名はグローバルに一意である必要があるため、実際の作成時にアカウントID等のサフィックスを付ける)。

全リソースに以下のタグを付与する:

| タグキー | 値 |
|---------|-----|
| Project | sales-report-automation |

## テクノロジースタック

| 分類 | サービス/技術 | 選定理由 |
|------|--------------|----------|
| スケジューラ | Amazon EventBridge Scheduler | cron式 + タイムゾーン指定(Asia/Tokyo)で「毎月1日9:00 JST」をUTC換算せずそのまま設定できる(要件2) |
| ワークフロー | AWS Step Functions(Standardワークフロー) | 実行履歴が長期保存され、各ステップの成功/失敗をコンソールで可視化できる。月1回の実行なので実行回数課金のExpressにするメリットがない(要件3) |
| コンピュート | AWS Lambda(Node.js 22.x ランタイム, arm64) | サーバー管理不要。Node.js 22.xは執筆時点の最新LTSランタイム。arm64(Graviton2)はx86_64より低コスト・高効率 |
| 実装言語 | TypeScript(ビルド後のJavaScript(ESM)をデプロイ) | 型安全性により実装ミスを早期発見できる。ただしLambdaランタイムはTypeScriptを直接実行できないため、ローカルで`tsc`によりJavaScriptへコンパイルしてからデプロイする([development-guidelines.md](./development-guidelines.md#コーディング規約lambda-typescript)参照) |
| ストレージ | Amazon S3(2バケット) | 売上CSVの入力、レポートの出力それぞれに専用バケットを分離し、権限を最小化する(要件1、要件5) |
| メッセージング | Amazon SQS(標準キュー + DLQ) | レポート作成とメール送信を非同期化。標準キューは順序保証が不要なこの用途に適し、コストも低い(要件6、要件8) |
| メール配信 | Amazon SES | Lambdaから直接呼び出せるAWSネイティブなメール配信サービス(要件7) |
| ログ・監視 | Amazon CloudWatch Logs | Lambda・Step Functionsの実行ログを自動収集 |
| 構築方法 | AWSマネジメントコンソール(手動) | 学習目的のため、コンソール上で各設定項目を確認しながら構築する |

## アーキテクチャパターン: サーバーレス・イベント駆動ワークフロー

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

各コンポーネントは疎結合であり、EventBridge/Step Functions/SQSといった「つなぎ役」のマネージドサービスが、Lambda間の直接呼び出しを避けている。これにより、1つのLambdaの障害が他のLambdaの実装に影響しない。

## リソース設計詳細

### 1. S3バケット

#### 売上CSVバケット(例: `sales-report-automation-source-<suffix>`)

| 設定項目 | 値 | 理由 |
|---------|-----|------|
| バージョニング | **無効**(デモのため) | 本来は誤って上書き/削除しても復元できるよう有効化を推奨するが、本プロジェクトは学習用デモのため、復元性よりシンプルさを優先し無効のままとする。本番運用では有効化を検討すること |
| パブリックアクセスブロック | すべてブロック(4項目すべてON) | 売上データを外部に公開しない |
| デフォルト暗号化 | SSE-S3(AES-256) | 保存データを暗号化する(セキュリティ要件) |
| ライフサイクルルール | なし(MVP) | 月1回・少量のため当面は無期限保持 |
| オブジェクトキーのプレフィックス | `sales/`配下に配置(例: `sales/sales_202401.csv`) | バケット直下に置かず1階層のプレフィックスを設けることで、将来同じバケットに別種のファイルを置く場合でもIAMポリシーのリソース指定(`sales/*`)で権限を絞り込める |

#### レポート保存バケット(例: `sales-report-automation-reports-<suffix>`)

上記と同じ設定(バージョニング無効、パブリックアクセスブロック、SSE-S3暗号化)に加え、オブジェクトキーは`reports/`配下に配置する(例: `reports/sales-report-2024-01.csv`)。売上CSVバケットの`sales/`プレフィックスと同じ考え方で、IAMポリシーのリソース指定(`reports/*`)を絞り込めるようにするため。

### 2. EventBridge Scheduler

| 設定項目 | 値 |
|---------|-----|
| スケジュール式 | `cron(0 9 1 * ? *)` |
| タイムゾーン(ScheduleExpressionTimezone) | `Asia/Tokyo` |
| ターゲット | Step Functionsステートマシンの`StartExecution` |
| フレックスタイムウィンドウ | OFF(定刻ちょうどに実行) |
| 実行ロール | `states:StartExecution`権限のみを持つ専用IAMロール(最小権限) |

**補足**: EventBridge Schedulerはタイムゾーンを直接指定できるため、UTC変換した`cron(0 0 1 * ? *)`を書く必要がない。`Asia/Tokyo`を指定すれば`9`とそのまま書けばよく、設定ミスを防げる。

### 3. Step Functions

| 設定項目 | 値 |
|---------|-----|
| 名前 | `SalesReportWorkflow` |
| タイプ | Standard |
| 定義(概要) | `Task(売上集計Lambda呼び出し)` → `Task(レポート作成Lambda呼び出し)` → `End` |
| ロギング | CloudWatch Logsへ`ALL`レベルで出力(学習用に全イベントを記録) |
| 実行ロール | 2つのLambdaへの`lambda:InvokeFunction`権限のみ(最小権限) |

### 4. Lambda関数(共通設定)

| 設定項目 | 値 |
|---------|-----|
| ランタイム | Node.js 22.x |
| アーキテクチャ | arm64 |
| ログ保持期間(CloudWatch Logsロググループ) | 14日(デフォルトの「無期限」からコスト観点で変更) |

#### Lambda: 売上集計(`SalesAggregatorFunction`)

| 設定項目 | 値 |
|---------|-----|
| メモリ | 256MB |
| タイムアウト | 30秒 |
| 環境変数 | `SOURCE_BUCKET_NAME` |
| IAMロール | 売上CSVバケットの`sales/*`プレフィックス配下への`s3:GetObject`のみ(最小権限。リソースARN: `arn:aws:s3:::<売上CSVバケット名>/sales/*`) |
| トリガー | Step Functions(直接呼び出し) |

#### Lambda: レポート作成(`ReportGeneratorFunction`)

| 設定項目 | 値 |
|---------|-----|
| メモリ | 256MB |
| タイムアウト | 30秒 |
| 環境変数 | `REPORT_BUCKET_NAME`, `NOTIFICATION_QUEUE_URL` |
| IAMロール | レポートバケットへの`s3:PutObject`、通知キューへの`sqs:SendMessage`(最小権限) |
| トリガー | Step Functions(直接呼び出し) |

#### Lambda: メール送信(`EmailSenderFunction`)

| 設定項目 | 値 |
|---------|-----|
| メモリ | 128MB |
| タイムアウト | 15秒 |
| 環境変数 | `SENDER_EMAIL`, `RECIPIENT_EMAILS`(カンマ区切り) |
| IAMロール | `ses:SendEmail`, `ses:SendRawEmail`(最小権限) |
| トリガー | SQS(レポート通知キュー)のイベントソースマッピング、バッチサイズ = 1 |

**バッチサイズを1にする理由**: 複数メッセージをまとめて受け取ると、1件だけ失敗した場合でもバッチ全体が失敗扱いになり得る。1件ずつ処理することで、成功/失敗の切り分けを確実にする。

### 5. SQS

#### レポート通知キュー(`sales-report-automation-notification-queue`)

| 設定項目 | 値 | 理由 |
|---------|-----|------|
| キュータイプ | 標準キュー | 順序保証・厳密な重複排除は不要 |
| 可視性タイムアウト | 90秒 | Lambda(メール送信)のタイムアウト(15秒)の6倍を目安に設定(AWSのベストプラクティス) |
| メッセージ保持期間 | 4日(デフォルト) | 即時処理が前提のため延長不要 |
| Redrive Policy | maxReceiveCount = 3、対象DLQを指定 | 要件8の「一定回数リトライ」を実現する中核設定 |

#### DLQ(`sales-report-automation-notification-dlq`)

| 設定項目 | 値 | 理由 |
|---------|-----|------|
| キュータイプ | 標準キュー | メインキューと合わせる |
| メッセージ保持期間 | 14日 | デフォルト4日では調査・再処理の猶予が短いため延長 |

### 6. SES(Amazon Simple Email Service)

| 設定項目 | 値 |
|---------|-----|
| 運用モード | サンドボックス(MVPのまま) |
| 送信元(Identity) | 検証済みメールアドレス(Verified identity) |
| 宛先 | 検証済みメールアドレスのみ送信可(今回はユーザーのGmailアドレスを検証して使用) |

**サンドボックス制約の注意点**: サンドボックスモードでは、送信元・宛先の両方がSESで「検証済み(Verified)」である必要がある。本番運用に移行するには、AWSサポートへ本番アクセスをリクエストする必要がある(スコープ外・Post-MVPの将来対応として`product-requirements.md`に記載済み)。

## セキュリティアーキテクチャ

### 最小権限の原則

各Lambda・EventBridge Scheduler・Step Functionsには、それぞれ専用のIAMロールを作成し、必要なリソース・アクションのみを許可する(上記の各リソース設定を参照)。ワイルドカード(`*`)によるリソース指定は避け、対象バケットARN/キューARN/関数ARNを明示的に指定する。

### データ保護

- S3: SSE-S3によるデフォルト暗号化、パブリックアクセスブロック
- SQS: 保存データの暗号化(SSE-SQS、AWS管理キー)を有効化する

### 機密情報の管理

- 送信元・宛先メールアドレスはLambdaのコードにハードコードせず、環境変数で管理する
- 今回の学習用構築ではAWS Secrets Managerは使用しない(メールアドレスは機密情報ではなく設定値のため)

## 運用・監視

- 各Lambda・Step Functionsの実行結果はCloudWatch Logsで確認する
- DLQにメッセージが滞留していないかは、MVPでは月次でコンソールから手動確認する(将来的にCloudWatch AlarmでDLQのメッセージ数を監視し、SNS通知することを検討)

## コスト概算

月1回の実行かつ処理データ量も小さいため、以下はいずれもAWS無料利用枠の範囲内、または無料枠を超えても数十円/月程度に収まる想定:

- Lambda: 月3回の呼び出し(集計・レポート作成・メール送信)
- Step Functions(Standard): 月1回の実行、状態遷移数もごく少数
- EventBridge Scheduler: 月1回のスケジュール実行
- SQS: 月数件のメッセージ
- S3: 数MB程度のCSV/レポートファイル
- SES: 月数通のメール送信

## テスト戦略(動作確認方針)

`docs/functional-design.md`のテスト戦略(単体確認→結合確認→異常系確認)に従う。加えて、構築時には以下の順で確認する:

1. 各リソースを個別に作成し、コンソール上で設定値を確認する
2. Lambda単体をテストイベントで実行し、入出力を確認する
3. Step Functionsを手動実行(Start Execution)し、一連のワークフローを確認する
4. EventBridge Schedulerは、実際に毎月1日を待たずに一時的なテスト用スケジュール、またはStep Functionsの手動実行で代替確認する

## 技術的制約

- AWSアカウント・リージョン: ap-northeast-1が利用可能であること
- SESがサンドボックスモードのため、検証済みメールアドレス以外には送信できない
- 構築はAWSマネジメントコンソールでの手動作業のため、環境の再現性はドキュメント(本ファイル)に依存する(IaC化はスコープ外)

## 依存関係管理(Lambda実装時)

| ライブラリ | 用途 | デプロイ時の扱い |
|-----------|------|-----------------|
| `@aws-sdk/client-s3` | S3からのCSV取得、レポートファイルの保存 | Node.js 22.xランタイムに同梱済み。コンパイル後のコードは`import`するだけでよく、バンドル不要 |
| `@aws-sdk/client-sqs` | SQSへの通知メッセージ送信 | 同上(ランタイム同梱) |
| `@aws-sdk/client-ses` | SESでのメール送信 | 同上(ランタイム同梱) |
| `typescript`, `@types/node`, `@types/aws-lambda`, `@aws-sdk/client-*` | ローカルでの型チェック・コンパイル用 | **devDependencies**。実行時には使われず、`tsc`によるコンパイル時にのみ必要 |

**方針**: AWS SDK for JavaScript v3はNode.js 22.xランタイムに同梱されているため、本番コード(コンパイル後のJS)はnode_modulesをバンドルせず、コンソールへの単一ファイル貼り付け(`index.mjs`)でデプロイできる。`@aws-sdk/client-*`パッケージはローカルでの型チェック専用(devDependencies)として導入し、実行時の挙動はLambdaランタイム同梱バージョンに委ねる。
