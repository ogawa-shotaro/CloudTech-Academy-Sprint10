# リポジトリ構造定義書 (Repository Structure Document)

## 前提

このプロジェクトはAWSマネジメントコンソールでの手動構築が前提であり、IaC(Terraform/CDK等)によるインフラのコード化は行わない。そのため本ドキュメントは、一般的なアプリケーション開発リポジトリとは異なり、以下を主目的として構造を定義する:

- 3つのLambda関数の**ソースコード**(コンソールへ貼り付け/アップロードする実体をバージョン管理する)
- 構築・運用の**ドキュメントと手順書**
- 動作確認の**証跡(スクリーンショット等)**

## プロジェクト構造

```
project-root/
├── docs/                          # 永続ドキュメント
│   ├── ideas/
│   │   └── initial-requirements.md
│   ├── product-requirements.md
│   ├── functional-design.md
│   ├── architecture.md
│   ├── repository-structure.md    # 本ドキュメント
│   ├── development-guidelines.md
│   ├── glossary.md
│   └── evidence/                  # 動作確認のスクリーンショット等の証跡
├── src/
│   └── lambdas/                   # 3つのLambda関数のTypeScriptソースコード
│       ├── sales-aggregator/      # 売上集計関数
│       │   └── index.mts
│       ├── report-generator/      # レポート作成関数
│       │   └── index.mts
│       └── email-sender/          # メール送信関数
│           └── index.mts
├── dist/                          # ビルド成果物(コンパイル後のJS。コンソールに貼り付ける実体)
│   └── lambdas/
│       ├── sales-aggregator/index.mjs
│       ├── report-generator/index.mjs
│       └── email-sender/index.mjs
├── package.json                   # ルート共通(typescript等のdevDependencies、buildスクリプト)
├── tsconfig.json                  # TypeScriptのコンパイル設定
├── runbooks/                      # 運用手順書(構築完了後の運用フェーズで使う)
│   └── dlq-reprocessing.md        # DLQに滞留したメッセージの確認・再処理手順
├── .steering/                     # 作業単位ドキュメント
│   └── [YYYYMMDD]-[task-name]/
├── .claude/                       # Claude Code設定
│   ├── commands/
│   ├── skills/
│   └── agents/
├── CLAUDE.md
└── README.md
```

**`dist/`は`.gitignore`で除外する**(ビルド成果物のため。`npm run build`でいつでも再生成できる)。

## ディレクトリ詳細

### docs/evidence/ (動作確認の証跡)

**役割**: `docs/functional-design.md`のテスト戦略で定義した動作確認(単体確認・結合確認・異常系確認)を実施した際のスクリーンショットや実行ログを保存する。

**命名規則**: `[YYYYMMDD]-[確認内容].png` 形式
例: `20250201-stepfunctions-success-execution.png`, `20250201-dlq-message-check.png`

### src/lambdas/ (Lambdaソースコード、TypeScript)

**役割**: Lambda関数のソースコード(TypeScript)を、変更履歴を追えるようGitで管理する。`npm run build`でコンパイルした`dist/`配下のJSを実際にコンソールへ貼り付ける。コンソールでの手動構築であっても、コードそのものはこのリポジトリを正とする。

**配置ファイル**(各関数フォルダ共通):
- `index.mts`: ハンドラー本体(TypeScript、ESM)

**命名規則**:
- フォルダ名: kebab-case、`architecture.md`で定義した関数名に対応させる
  - `sales-aggregator/` ↔ `SalesAggregatorFunction`
  - `report-generator/` ↔ `ReportGeneratorFunction`
  - `email-sender/` ↔ `EmailSenderFunction`
- ソースファイル名は`index.mts`に統一。コンパイル後は`index.mjs`になり、コンソールのデフォルトハンドラー設定`index.handler`と一致させる(設定ミスを防ぐ)

**依存関係**:
- 各Lambdaフォルダは独立しており、フォルダ間でコードを共有・import**しない**(3関数とも小規模かつ責務が明確に分離しているため、共有モジュールを作るコストの方が高い)
- npm依存関係(`typescript`, `@types/node`, `@types/aws-lambda`, `@aws-sdk/client-*`)はルートの`package.json`で一元管理する(関数ごとに持たない)

**例**:
```
src/lambdas/sales-aggregator/
└── index.mts

# ビルド後
dist/lambdas/sales-aggregator/
└── index.mjs    # この中身をコンソールに貼り付ける
```

### runbooks/ (運用手順書)

**役割**: 構築完了後、実際の運用(特に異常時対応)で参照する手順書を配置する。設計判断の説明ではなく「今何をすべきか」を淡々と書く。

**配置ファイル**:
- `dlq-reprocessing.md`: DLQ(SQS)に溜まったメッセージをコンソールで確認し、原因調査後に元のキューへ再投入する手順

## ファイル配置規則

| ファイル種別 | 配置先 | 命名規則 | 例 |
|------------|--------|---------|-----|
| Lambdaハンドラー(ソース) | `src/lambdas/[関数名kebab-case]/` | `index.mts` | `src/lambdas/email-sender/index.mts` |
| Lambdaハンドラー(ビルド成果物) | `dist/lambdas/[関数名kebab-case]/` | `index.mjs` | `dist/lambdas/report-generator/index.mjs` |
| 永続ドキュメント | `docs/` | `[ドキュメント種別].md` | `docs/architecture.md` |
| 動作確認証跡 | `docs/evidence/` | `[YYYYMMDD]-[内容].png` | `docs/evidence/20250201-dlq-message-check.png` |
| 運用手順書 | `runbooks/` | `[対象].md` | `runbooks/dlq-reprocessing.md` |
| 作業単位ドキュメント | `.steering/[YYYYMMDD]-[タスク名]/` | `requirements.md`, `design.md`, `tasklist.md` | `.steering/20250201-add-sales-aggregator/tasklist.md` |

## 命名規則

### ディレクトリ名
- kebab-case を使用する(例: `sales-aggregator/`, `report-generator/`)
- Lambda関数名(`architecture.md`で定義したPascalCase名)とは1対1で対応させ、対応表を`repository-structure.md`(本ドキュメント)に維持する

### ファイル名
- Lambdaハンドラー: ソースは`index.mts`、ビルド成果物は`index.mjs`に統一
- ドキュメント: kebab-case、内容が分かる名前(例: `dlq-reprocessing.md`)

## .gitignore に含めるもの

- `node_modules/`
- `dist/`(ビルド成果物。`npm run build`で再生成可能)
- `*.zip`(コンソールにアップロードするデプロイパッケージのビルド成果物。今回は単一ファイル貼り付けのため基本的に発生しない想定)
- `.env`(ローカル確認用にAWS認証情報等を置く場合)
- `.steering/`は履歴として残す方針のため除外しない(CLAUDE.mdの原則に従う)

## スケーリング戦略(将来Lambdaが増えた場合)

- 4つ目以降のLambda関数が追加される場合も、`src/lambdas/[関数名]/`として同じパターンで追加する
- 複数のLambdaで本当に共通するロジック(例: 共通のログフォーマット関数)が生まれた場合のみ、`src/lambdas/shared/`を作成して参照する(現時点では該当なし)
