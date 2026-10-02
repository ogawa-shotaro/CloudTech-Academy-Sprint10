# 開発ガイドライン (Development Guidelines)

## 前提

このプロジェクトはソロ(個人)学習プロジェクトであり、AWSマネジメントコンソールでの手動構築が前提。そのため、一般的なチーム開発向けテンプレート(PRレビュー必須、CI/CD、自動テストカバレッジ目標など)をそのまま適用せず、実態に合わせて簡略化する。

## コーディング規約(Lambda: TypeScript)

### 言語とビルドの方針

- 実装はTypeScript(`.mts`)で行う。AWS Lambdaランタイムは TypeScript を直接実行できないため、**ローカルで`tsc`によりJavaScript(ESM、`.mjs`)へコンパイルしてから、コンソールへ貼り付ける**
- ソース: `src/lambdas/[関数名]/index.mts`
- コンパイル後の成果物: `dist/lambdas/[関数名]/index.mjs`(このファイルの中身をLambdaコンソールの`index.mjs`に貼り付ける)
- ビルドコマンド: ルートの`package.json`に定義した`npm run build`(内部で`tsc`を実行)
- 型定義: `@types/aws-lambda`を使い、`S3Event`や`SQSEvent`などLambdaイベントの型を正しく付ける。`@aws-sdk/client-*`の型はパッケージ自体に同梱されている

### モジュール形式

- ESM(`import`/`export`)を使用する。`tsconfig.json`で`module: "nodenext"`、`moduleResolution: "nodenext"`を設定し、`.mts`ファイルが`.mjs`としてコンパイルされるようにする
- 理由: Node.js 22.xではESMが標準的であり、`require`とのモジュール形式混在を避けられる

### 命名規則

- 変数・関数: camelCase、関数は動詞で始める(例: `parseSalesCsv`, `buildReportSummary`)
- 定数: UPPER_SNAKE_CASE(例: `MAX_RETRY_COUNT`)
- 環境変数: UPPER_SNAKE_CASE、`architecture.md`で定義した名前をそのまま使う(例: `SOURCE_BUCKET_NAME`, `RECIPIENT_EMAILS`)

### AWS SDKクライアントの初期化

```typescript
// ✅ 良い例: モジュールスコープで1回だけ初期化(ウォームスタート時に再利用される)
import { S3Client } from '@aws-sdk/client-s3';
import type { Handler } from 'aws-lambda';

const s3Client = new S3Client({});

export const handler: Handler = async (event) => {
  // s3Client を使う
};

// ❌ 悪い例: ハンドラー内で毎回初期化するとコールドスタートのたびに無駄なオーバーヘッドが発生
export const handler: Handler = async (event) => {
  const s3Client = new S3Client({});
};
```

### 環境変数の参照

```typescript
// ✅ 良い例: モジュール冒頭で定数化し、型も明示する
const SOURCE_BUCKET_NAME: string = process.env.SOURCE_BUCKET_NAME ?? (() => {
  throw new Error('SOURCE_BUCKET_NAME is not set');
})();

// ❌ 悪い例: ハンドラー内で都度 process.env.SOURCE_BUCKET_NAME を参照する
```

### エラーハンドリング

- **エラーを握りつぶさない**: catchしたエラーは`console.error`でログに残した上で、必ず`throw`し直す(またはそもそもcatchしない)。Step Functionsやイベントソースマッピング(SQS)は、Lambdaが例外をthrowすることで初めて「失敗」を検知し、リトライ/DLQ移動の仕組みが正しく機能する
- ログはCloudWatch Logsで検索・原因特定しやすいよう、構造化して出力する
- `catch (error)`の`error`は`unknown`型になるため、メッセージを取り出す際は型ガードを行う

```typescript
// ✅ 良い例
try {
  await sendEmail(params);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ message: 'メール送信に失敗', error: message, params }));
  throw error; // 再送出することでSQSのリトライ/DLQ移動が機能する
}

// ❌ 悪い例: エラーを握りつぶすと、失敗してもSQSは「成功」とみなしメッセージを削除してしまう
try {
  await sendEmail(params);
} catch (error) {
  console.error(error);
  // throwしない → リトライもDLQ移動も起きない
}
```

### コメント規約

- 「何をしているか」ではなく「なぜそうしているか」を書く(CLAUDE.mdの全体方針と統一)
- 例: 「バッチサイズを1にしている」というコードに対して、コメントは「1件ずつ処理し失敗の切り分けを確実にするため」のように理由を書く

## Git運用ルール(個人開発向け)

### ブランチ戦略

- 基本は`main`ブランチへの直接コミットでよい(レビュアーがいないソロ開発のため)
- ドキュメント作成など、大きめの区切りごとに意味のある単位でコミットする
- 大きな試行錯誤をしたい場合のみ、`feature/[内容]`ブランチを一時的に切ってもよい(必須ではない)

### コミットメッセージ規約

Conventional Commitsの`type`を使いつつ、本文は日本語で記述する。

**フォーマット**:
```
<type>: <変更内容>
```

**Type**:
- `feat`: 新機能(例: 新しいLambda関数の追加)
- `docs`: ドキュメントの追加・更新(`docs/`配下)
- `fix`: 不具合修正
- `chore`: その他(README更新など)

**例**:
```
docs: architectureのリージョン選定理由を修正

EventBridge Schedulerのタイムゾーン指定はグローバル機能のため、
東京リージョンを選ぶ理由として不適切だった点を修正した。
```

### レビュープロセス

ソロ開発のため必須のPRレビューは設けない。ただし、以下のタイミングでは「一度立ち止まって見直す」ことを推奨する:

- 各永続ドキュメント(`docs/`)を作成・更新した直後
- Lambda関数のコードをコンソールにデプロイする直前

## 動作確認(テストの代わり)

自動テストは導入しない(構築自体が手動コンソール作業のため、自動化のメリットが小さい)。`docs/functional-design.md`のテスト戦略(単体確認→結合確認→異常系確認)に従い、以下を徹底する。

### テストイベントの保存

各Lambdaフォルダに、コンソールの「テスト」機能で使ったテストイベントJSONを保存しておく(次回同じ確認を再現できるようにするため)。

```
src/lambdas/sales-aggregator/
├── index.mjs
├── package.json
└── test-event.json    # コンソールでのテスト実行に使った入力例
```

### 証跡の保存

動作確認を行ったら、`docs/evidence/`にスクリーンショットを保存する(命名規則は`repository-structure.md`を参照)。

## セルフレビューチェックリスト

コードレビュアーがいないため、コンソールへデプロイする前に以下を自分で確認する。

- [ ] `architecture.md`で定義した環境変数名と一致しているか
- [ ] IAMロールに、必要以上の権限(ワイルドカードなど)を付与していないか
- [ ] catchしたエラーを握りつぶさず、`throw`し直しているか
- [ ] 送信元/宛先メールアドレスなど機密性のある値をコードにハードコードしていないか(環境変数を使っているか)
- [ ] ログにレポート内容(売上金額など)を必要以上に出力していないか

## 開発環境セットアップ

### 必要なツール

| ツール | バージョン | 用途 |
|--------|-----------|------|
| Node.js | 22.x | ローカルでのビルド・動作確認、Lambda本番ランタイムと合わせる |
| TypeScript(`typescript`パッケージ) | 5.x | `.mts`ソースを`.mjs`にコンパイルするため |
| AWSマネジメントコンソールへのアクセス | - | 実際のリソース構築 |
| AWS CLI(任意) | 最新版 | S3へのテスト用CSVアップロードなど、コンソール操作を省力化したい場合 |

### ビルド(TypeScript → JavaScript)

```bash
# ルートで一度だけ
npm install

# src/lambdas/**/index.mts を dist/lambdas/**/index.mjs にコンパイル
npm run build
```

コンパイル後、`dist/lambdas/[関数名]/index.mjs`の中身をそのままLambdaコンソールの`index.mjs`に貼り付ける。

### ローカルでの簡易動作確認

自動テストフレームワークは導入しないが、ビルド後のJavaScriptはただの関数なので、コンソールにデプロイする前にローカルの`node`コマンドで直接呼び出して動作確認できる。

```bash
node -e "
import('./dist/lambdas/sales-aggregator/index.mjs').then(async ({ handler }) => {
  const result = await handler({ /* テスト用の入力 */ });
  console.log(result);
});
"
```

AWS SDKを呼び出す部分はローカルにAWS認証情報(`aws configure`済みのプロファイル)があれば、実際のS3/SQS/SESに対して動作確認できる。
