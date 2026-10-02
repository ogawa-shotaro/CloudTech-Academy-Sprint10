import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
import type { SQSEvent, SQSHandler } from 'aws-lambda';

const SENDER_EMAIL: string =
  process.env.SENDER_EMAIL ??
  (() => {
    throw new Error('SENDER_EMAIL is not set');
  })();

const RECIPIENT_EMAILS: string[] = (
  process.env.RECIPIENT_EMAILS ??
  (() => {
    throw new Error('RECIPIENT_EMAILS is not set');
  })()
)
  .split(',')
  .map((email) => email.trim())
  .filter((email) => email.length > 0);

const sesClient = new SESClient({});

interface ReportNotificationMessage {
  reportBucket: string;
  reportKey: string;
  reportSummary: string;
  generatedAt: string;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  // バッチサイズ1で構成しているため、常に1件のレコードのみを処理する
  for (const record of event.Records) {
    const message: ReportNotificationMessage = JSON.parse(record.body);
    await sendReportEmail(message);
  }
};

async function sendReportEmail(message: ReportNotificationMessage): Promise<void> {
  try {
    await sesClient.send(
      new SendEmailCommand({
        Source: SENDER_EMAIL,
        Destination: { ToAddresses: RECIPIENT_EMAILS },
        Message: {
          Subject: { Data: `売上レポートのお知らせ(${message.reportKey})`, Charset: 'UTF-8' },
          Body: {
            Text: { Data: message.reportSummary, Charset: 'UTF-8' },
          },
        },
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({ message: 'メール送信に失敗', reportKey: message.reportKey, error: errorMessage }),
    );
    throw error; // 再送出することでSQSのリトライ/DLQ移動が機能する
  }
}
