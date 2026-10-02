# タスクリスト

## 進め方

このリストは、ユーザーがAWSマネジメントコンソールで実際に操作しながら1ステップずつ進める。Claude Codeは各タスクの直前に「設定内容の解説」と「具体的な入力値」を提示し、ユーザーの完了報告を受けてから`[x]`に更新する。

---

## フェーズ1: 基盤ストレージ・キューの作成

- [x] S3: 売上CSVバケットの作成
  - [x] バケット作成(バージョニング無効(デモのため)、パブリックアクセスブロック全有効、SSE-S3暗号化)
- [x] S3: レポート保存バケットの作成
  - [x] バケット作成(同上の設定)
- [x] SQS: DLQの作成
  - [x] `sales-report-automation-notification-dlq`作成(標準キュー、保持期間14日、SSE-SQS暗号化有効)
- [x] SQS: レポート通知キューの作成
  - [x] `sales-report-automation-notification-queue`作成(可視性タイムアウト90秒、Redrive Policy: maxReceiveCount=3、DLQを指定、SSE-SQS暗号化有効)

## フェーズ2: SESのセットアップ

- [x] 送信元メールアドレスの検証(Verified Identity)(送信元・宛先とも同一のGmailアドレスを使用)
- [x] 宛先メールアドレス(ユーザーのGmailアドレス)の検証(Verified Identity)

## フェーズ3: Lambda(売上集計)の作成

- [x] 売上CSVのフォーマット(カラム定義・集計軸)をユーザーから確認(カテゴリ別・日別・総売上を集計)
- [x] IAMロール作成(対象S3バケットへの`s3:GetObject`のみ。`sales-report-automation-sales-aggregator-role`、インラインポリシー+`AWSLambdaBasicExecutionRole`)
- [x] Lambda関数作成(`SalesAggregatorFunction`、Node.js 22.x、arm64、256MB、30秒、環境変数`SOURCE_BUCKET_NAME`)
- [x] `src/lambdas/sales-aggregator/index.mts`のコード実装(TypeScript、ビルド確認済み)
- [x] コンソールのテスト機能で動作確認、`test-event.json`として保存(カテゴリ別・日別合計が総売上と一致することを確認)

## フェーズ4: Lambda(レポート作成)の作成

- [x] IAMロール作成(レポートバケットへの`s3:PutObject`、通知キューへの`sqs:SendMessage`。`sales-report-automation-report-generator-role`)
- [x] Lambda関数作成(`ReportGeneratorFunction`、Node.js 22.x、arm64、256MB、30秒、環境変数`REPORT_BUCKET_NAME`, `NOTIFICATION_QUEUE_URL`)
- [x] `src/lambdas/report-generator/index.mts`のコード実装(TypeScript、ビルド確認済み)
- [x] コンソールのテスト機能で動作確認、`test-event.json`として保存(S3へのレポート保存、SQSへのメッセージ送信をAWS API経由で確認済み)

## フェーズ5: Lambda(メール送信)の作成

- [x] IAMロール作成(`ses:SendEmail`, `ses:SendRawEmail`。`sales-report-automation-email-sender-role`。AWS MCP(API)経由で作成)
- [x] Lambda関数作成(`EmailSenderFunction`、Node.js 22.x、arm64、128MB、15秒、環境変数`SENDER_EMAIL`, `RECIPIENT_EMAILS`)
- [x] `src/lambdas/email-sender/index.mts`のコード実装(TypeScript、ビルド確認済み)
- [x] SQS(レポート通知キュー)とのイベントソースマッピング設定(バッチサイズ1、AWS MCPで状態確認済み)
- [x] SQSへ手動でテストメッセージを送信し、メール受信を確認(フェーズ4で残っていたテストメッセージが自動処理され、メール受信を確認)

## フェーズ6: Step Functionsステートマシンの作成

- [x] IAMロール作成(2つのLambdaへの`lambda:InvokeFunction`。`sales-report-automation-stepfunctions-role`。AWS MCP(API)経由で作成)
- [x] ステートマシン定義(ASL)の作成(`SalesReportWorkflow`、Standard、集計→レポート作成の順。AWS MCPで状態確認済み)
- [x] CloudWatch Logsへのロギング設定(ALLレベル、実行データ含める。AWS MCPで状態確認済み)
- [x] 手動実行(Start Execution)で正常終了することを確認(集計→レポート作成が成功し、メール送信まで一気通貫で確認)

## フェーズ7: EventBridge Schedulerの作成

- [x] IAMロール作成(`states:StartExecution`。`sales-report-automation-scheduler-role`。AWS MCP(API)経由で作成)
- [x] スケジュール作成(`cron(0 9 1 * ? *)`、タイムゾーン`Asia/Tokyo`、ターゲット: ステートマシン。AWS MCPで状態確認済み)

## フェーズ8: 結合テスト・異常系確認

- [x] テスト用売上CSVをS3(売上CSV)に配置(フェーズ3で実施済み: `sales/sales_202401.csv`)
- [x] Step Functionsを手動実行し、集計→レポート作成→S3保存→SQS送信→メール受信までを確認(フェーズ6で実施済み)
- [x] メール送信を意図的に失敗させ(例: 未検証アドレスに一時変更)、3回リトライ後にDLQへメッセージが移動することを確認
- [x] DLQのメッセージを元のキューへ再投入し、正常に再処理されることを確認
- [x] 各確認結果を`docs/evidence/`に保存(AWS MCP経由のAPI確認結果・CloudWatch Logsをテキストで記録。`20261002-integration-and-error-handling-test.md`)

## フェーズ9: ドキュメント更新・振り返り

- [x] `runbooks/dlq-reprocessing.md`の作成(実際に行った再処理手順を反映)
- [x] 構築中に`docs/architecture.md`等との差分が生じた場合、該当ドキュメントを更新(TypeScript化、S3プレフィックス、バージョニング無効化、リージョン理由の修正などを都度反映済み)
- [x] 実装後の振り返りをこのファイル下部に記録

---

## 実装後の振り返り

### 実装完了日
2026-10-02

### 計画と実績の差分

**計画と異なった点**:
- Lambdaの実装言語を、当初のNode.js(素のJavaScript)からTypeScript(`.mts`→`tsc`でコンパイル)に変更した。これに伴い`architecture.md`、`development-guidelines.md`、`repository-structure.md`を事後更新し、ルートに`package.json`/`tsconfig.json`を追加した
- S3バケットのバージョニングを、当初「有効」としていたものを「デモのため無効」に変更(`architecture.md`も合わせて更新)
- S3オブジェクトキーに`sales/`・`reports/`というプレフィックスを追加する設計を構築途中で決定し、IAMポリシーのリソース指定をプレフィックス単位に絞った
- IAMロールの権限方針を「全てマネージドポリシー(FullAccess)で簡略化」する案も検討したが、最終的に当初通りの最小権限(インラインポリシー)方式に戻した
- 構築方法を「全てAWSマネジメントコンソールで手動」から、「Lambda本体の作成・SESなど学習したい部分はコンソール、IAMロール作成など定型的な部分はAWS MCP(API)経由」というハイブリッド方式に変更した

**新たに必要になったタスク**:
- `ReportGeneratorFunction`に誤って`sales-aggregator-role`(別の関数のロール)を割り当てていたミスを、CloudWatch LogsのAccessDeniedエラーとAWS MCPでの実行ロール確認により発見し、修正した
- IAM Identity Center(大阪リージョンで有効化されていた)と通常のIAMサービスを混同しないよう、ヒアリングの中で明確化した

**技術的理由でスキップしたタスク**:
- なし(全タスク完了)

### 学んだこと

**技術的な学び**:
- EventBridge Schedulerのタイムゾーン指定(`Asia/Tokyo`)はどのリージョンでも使えるグローバル機能であり、リージョン選定の理由にはならない。リージョンを選ぶ本質的な理由は、SESの送信レピュテーション・データ所在地・運用者のレイテンシといった非コスト要因である
- SQSの可視性タイムアウトは「Lambdaのタイムアウトの6倍以上」が目安。短すぎると同じメッセージが重複処理される恐れがある
- Lambda(SQSイベントソースマッピング)は、キューの可視性タイムアウトとは別に内部的なリトライ間隔を持つため、実際のリトライ間隔は可視性タイムアウトの値と一致しない場合がある(今回は90秒設定に対し約30秒間隔で再試行された)
- SQSコンソールの「メッセージをポーリング」は、結果整合性やタイミングにより実際と異なる表示(「No messages」)になることがある。AWS APIで`GetQueueAttributes`を直接確認する方が確実
- 「IAM」と「IAM Identity Center」は名前が似ているが全くの別サービスで、後者は有効化リージョンに固定される
- SQSトリガーのLambdaでは、エラーを握りつぶさず`throw`し直すことが、リトライ/DLQ移動の仕組みが機能するための大前提になる

**プロセス上の改善点**:
- AWS MCP(API)を併用したことで、コンソール操作のミス(IAMロールの選択違いなど)を会話の中で即座に特定・修正でき、手戻りが少なかった
- 構成図の共有→要件のヒアリング→PRD/設計書の段階的作成→1ステップずつの構築、という進め方により、各AWSサービスの設定理由を都度理解しながら進められた
- ユーザーからの「本当にこの設定でいいのか」という都度の確認・差し戻し(バージョニング、IAM方針など)が、ドキュメントと実態の乖離を防ぐ結果になった

### 次回への改善提案
- 実装言語(TypeScriptかどうか)やIAMの権限方針など、構築全体に影響する決定は、要件定義・アーキテクチャ設計の段階でより早く確定しておくと、ドキュメントの手戻りを減らせる
- IAMロールをコンソールで選択する操作は特にヒューマンエラーが起きやすいため、ロール作成・アタッチ直後にAWS MCPで設定内容(実行ロールARNなど)を確認する習慣を最初から徹底するとよい
- 今回はMVPスコープ外としたが、CloudWatch AlarmによるDLQ滞留の自動検知(SNS通知など)は、本番運用を見据えるなら早めに追加を検討したい
