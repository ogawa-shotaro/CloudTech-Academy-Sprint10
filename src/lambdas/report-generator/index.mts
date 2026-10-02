import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { Handler } from 'aws-lambda';

const REPORT_BUCKET_NAME: string =
  process.env.REPORT_BUCKET_NAME ??
  (() => {
    throw new Error('REPORT_BUCKET_NAME is not set');
  })();

const NOTIFICATION_QUEUE_URL: string =
  process.env.NOTIFICATION_QUEUE_URL ??
  (() => {
    throw new Error('NOTIFICATION_QUEUE_URL is not set');
  })();

const s3Client = new S3Client({});
const sqsClient = new SQSClient({});

interface CategoryTotal {
  category: string;
  totalSales: number;
}

interface DateTotal {
  date: string;
  totalSales: number;
}

interface AggregationResult {
  aggregationPeriod: string;
  totalSales: number;
  byCategory: CategoryTotal[];
  byDate: DateTotal[];
  sourceCsvKey: string;
}

interface ReportNotificationMessage {
  reportBucket: string;
  reportKey: string;
  reportSummary: string;
  generatedAt: string;
}

export const handler: Handler<AggregationResult, ReportNotificationMessage> = async (event) => {
  const reportKey = `reports/sales-report-${event.aggregationPeriod}.csv`;
  const reportCsv = buildReportCsv(event);

  await uploadReport(reportKey, reportCsv);

  const message: ReportNotificationMessage = {
    reportBucket: REPORT_BUCKET_NAME,
    reportKey,
    reportSummary: buildReportSummary(event),
    generatedAt: new Date().toISOString(),
  };

  await sendNotification(message);

  console.log(JSON.stringify({ message: 'レポート作成が完了', reportKey }));

  return message;
};

function buildReportCsv(result: AggregationResult): string {
  const lines: string[] = [];
  lines.push('項目,値');
  lines.push(`集計対象月,${result.aggregationPeriod}`);
  lines.push(`総売上,${result.totalSales}`);
  lines.push('');
  lines.push('カテゴリ,売上');
  for (const { category, totalSales } of result.byCategory) {
    lines.push(`${category},${totalSales}`);
  }
  lines.push('');
  lines.push('日付,売上');
  for (const { date, totalSales } of result.byDate) {
    lines.push(`${date},${totalSales}`);
  }
  return lines.join('\n');
}

function buildReportSummary(result: AggregationResult): string {
  const categoryLines = result.byCategory
    .map(({ category, totalSales }) => `- ${category}: ¥${totalSales.toLocaleString('ja-JP')}`)
    .join('\n');

  return [
    `${result.aggregationPeriod}の売上レポートが作成されました。`,
    `総売上: ¥${result.totalSales.toLocaleString('ja-JP')}`,
    'カテゴリ別内訳:',
    categoryLines,
  ].join('\n');
}

async function uploadReport(key: string, body: string): Promise<void> {
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: REPORT_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: 'text/csv; charset=utf-8',
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: 'レポートの保存に失敗', key, error: message }));
    throw error;
  }
}

async function sendNotification(message: ReportNotificationMessage): Promise<void> {
  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: NOTIFICATION_QUEUE_URL,
        MessageBody: JSON.stringify(message),
      }),
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: '通知メッセージの送信に失敗', error: msg }));
    throw error;
  }
}
