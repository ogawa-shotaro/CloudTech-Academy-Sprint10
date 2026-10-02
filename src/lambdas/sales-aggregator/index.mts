import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Handler } from 'aws-lambda';

const SOURCE_BUCKET_NAME: string =
  process.env.SOURCE_BUCKET_NAME ??
  (() => {
    throw new Error('SOURCE_BUCKET_NAME is not set');
  })();

const s3Client = new S3Client({});

interface AggregationInput {
  /** "YYYY-MM"。省略時は実行日の前月を自動算出する(毎月1日に前月分を集計する運用のため) */
  targetMonth?: string;
}

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

interface SalesRow {
  date: string;
  category: string;
  totalPrice: number;
}

export const handler: Handler<AggregationInput, AggregationResult> = async (event) => {
  const aggregationPeriod = event?.targetMonth ?? resolvePreviousMonth();
  const sourceCsvKey = `sales/sales_${aggregationPeriod.replace('-', '')}.csv`;

  const csvText = await fetchCsv(sourceCsvKey);
  const rows = parseCsv(csvText);
  const result = aggregate(rows, aggregationPeriod, sourceCsvKey);

  console.log(
    JSON.stringify({
      message: '売上集計が完了',
      aggregationPeriod: result.aggregationPeriod,
      totalSales: result.totalSales,
      rowCount: rows.length,
    }),
  );

  return result;
};

function resolvePreviousMonth(): string {
  const now = new Date();
  // 実行は毎月1日なので、対象は常に前月の売上データ
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const year = previousMonth.getUTCFullYear();
  const month = String(previousMonth.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function fetchCsv(key: string): Promise<string> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: SOURCE_BUCKET_NAME, Key: key }),
    );
    const body = await response.Body?.transformToString('utf-8');
    if (!body) {
      throw new Error(`S3オブジェクトの中身が空です: ${key}`);
    }
    return body;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ message: '売上CSVの取得に失敗', key, error: message }));
    throw error;
  }
}

function parseCsv(csvText: string): SalesRow[] {
  const lines = csvText.trim().split('\n');
  const [header, ...dataLines] = lines;
  const columns = header.split(',');

  const dateIndex = columns.indexOf('date');
  const categoryIndex = columns.indexOf('category');
  const totalPriceIndex = columns.indexOf('total_price');

  if (dateIndex === -1 || categoryIndex === -1 || totalPriceIndex === -1) {
    throw new Error('CSVに必要な列(date, category, total_price)が見つかりません');
  }

  // シンプルなカンマ分割。値にカンマを含むフィールド(クォート付きCSV)には非対応
  return dataLines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cells = line.split(',');
      return {
        date: cells[dateIndex],
        category: cells[categoryIndex],
        totalPrice: Number(cells[totalPriceIndex]),
      };
    });
}

function aggregate(
  rows: SalesRow[],
  aggregationPeriod: string,
  sourceCsvKey: string,
): AggregationResult {
  const categoryTotals = new Map<string, number>();
  const dateTotals = new Map<string, number>();
  let totalSales = 0;

  for (const row of rows) {
    totalSales += row.totalPrice;
    categoryTotals.set(row.category, (categoryTotals.get(row.category) ?? 0) + row.totalPrice);
    dateTotals.set(row.date, (dateTotals.get(row.date) ?? 0) + row.totalPrice);
  }

  return {
    aggregationPeriod,
    totalSales,
    byCategory: Array.from(categoryTotals, ([category, totalSales]) => ({ category, totalSales })),
    byDate: Array.from(dateTotals, ([date, totalSales]) => ({ date, totalSales })),
    sourceCsvKey,
  };
}
