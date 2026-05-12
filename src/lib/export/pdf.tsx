/**
 * PDF generator using @react-pdf/renderer.
 *
 * The layout intentionally mirrors the web ledger more closely: a quiet
 * header, card-like sections, tabular rows, and member share columns instead
 * of an abstract split-rule label.
 */

import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ExportPayload, ExportRowExpense, ExportRowMember } from './data';

const BORDER = '#d7dde5';
const MUTED = '#64748b';
const HEADER_BG = '#f1f5f9';
const CARD_BG = '#fbfdff';
const TEXT = '#111827';
const GREEN = '#047857';
const RED = '#b91c1c';
const CJK_FONT_FAMILY = 'AAEasyCJK';
const require = createRequire(import.meta.url);

let registeredFontFamily: string | null = null;

interface PdfFontFiles {
  regular: string;
  bold: string;
}

function resolvePackageFontPath(path: string): string | null {
  try {
    return require.resolve(path);
  } catch {
    return null;
  }
}

function resolveCjkFontFiles(): PdfFontFiles | null {
  const bundledRegular = resolvePackageFontPath(
    '@expo-google-fonts/noto-sans-sc/400Regular/NotoSansSC_400Regular.ttf',
  );
  const bundledBold = resolvePackageFontPath(
    '@expo-google-fonts/noto-sans-sc/700Bold/NotoSansSC_700Bold.ttf',
  );
  if (bundledRegular && bundledBold) {
    return { regular: bundledRegular, bold: bundledBold };
  }

  const candidates = [
    process.env.PDF_CJK_FONT_PATH,
    // Docker / Alpine with `font-noto-cjk` installed.
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.otf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    // macOS development machines.
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Supplemental/Songti.ttc',
  ].filter(Boolean) as string[];

  const regular = candidates.find((path) => existsSync(path));
  if (!regular) return null;
  const bold = process.env.PDF_CJK_FONT_BOLD_PATH;
  return { regular, bold: bold && existsSync(bold) ? bold : regular };
}

function ensurePdfFont(): string {
  if (registeredFontFamily) return registeredFontFamily;
  const fontFiles = resolveCjkFontFiles();
  if (!fontFiles) {
    registeredFontFamily = 'Helvetica';
    return registeredFontFamily;
  }

  Font.register({
    family: CJK_FONT_FAMILY,
    fonts: [
      { src: fontFiles.regular, fontWeight: 400 },
      { src: fontFiles.bold, fontWeight: 700 },
    ],
  });
  registeredFontFamily = CJK_FONT_FAMILY;
  return registeredFontFamily;
}

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 8,
    color: TEXT,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 3 },
  meta: { fontSize: 8, color: MUTED },
  badge: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: HEADER_BG,
    fontSize: 8,
  },
  section: {
    marginTop: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    backgroundColor: CARD_BG,
  },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 7 },
  table: {
    width: '100%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: BORDER,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    minHeight: 20,
  },
  rowHeader: { backgroundColor: HEADER_BG, fontWeight: 700 },
  zebra: { backgroundColor: '#ffffff' },
  cell: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  cellRight: { textAlign: 'right' },
  muted: { color: MUTED },
  positive: { color: GREEN },
  negative: { color: RED },
  detailBlock: {
    marginTop: 7,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 5,
    overflow: 'hidden',
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: HEADER_BG,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  detailRow: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: '#ffffff',
  },
  empty: { color: MUTED, paddingVertical: 4 },
});

function isZh(locale: string): boolean {
  return locale.toLowerCase().startsWith('zh');
}

function labels(locale: string) {
  if (isZh(locale)) {
    return {
      generated: '生成时间',
      defaultCurrency: '默认币种',
      expenses: '费用明细',
      date: '日期',
      expense: '费用',
      payer: '垫付者',
      amount: '金额',
      summary: '汇总',
      member: '成员',
      paid: '实付',
      owed: '应付',
      net: '净额',
      memberDetails: '成员明细',
      totalShare: '分摊合计',
      noSharedExpenses: '无分摊费用。',
      transfers: '转账建议',
      from: '付款人',
      to: '收款人',
      allSettled: '已结清，无需转账。',
    };
  }
  return {
    generated: 'Generated',
    defaultCurrency: 'Default currency',
    expenses: 'Expenses',
    date: 'Date',
    expense: 'Expense',
    payer: 'Payer',
    amount: 'Amount',
    summary: 'Summary',
    member: 'Member',
    paid: 'Paid',
    owed: 'Owed',
    net: 'Net',
    memberDetails: 'Member Details',
    totalShare: 'Total share',
    noSharedExpenses: 'No shared expenses.',
    transfers: 'Transfers',
    from: 'From',
    to: 'To',
    allSettled: 'All settled. No transfers needed.',
  };
}

function formatGenerated(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface CellProps {
  text: string;
  width: string;
  align?: 'left' | 'right';
  bold?: boolean;
  color?: string;
}

function Cell({ text, width, align, bold, color }: CellProps) {
  return (
    <View style={[styles.cell, { width }]}>
      <Text
        style={[
          align === 'right' ? styles.cellRight : {},
          bold ? { fontWeight: 700 } : {},
          color ? { color } : {},
        ]}
      >
        {text}
      </Text>
    </View>
  );
}

function moneyColor(value: number) {
  if (value > 0) return GREEN;
  if (value < 0) return RED;
  return MUTED;
}

type PdfLabels = ReturnType<typeof labels>;

function ExpensesTable({ payload, l }: { payload: ExportPayload; l: PdfLabels }) {
  const fixedWidths = {
    date: '8%',
    title: '19%',
    payer: '10%',
    amount: '11%',
  };
  const shareWidth = `${Math.max(7, Math.floor(52 / Math.max(1, payload.members.length)))}%`;

  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.rowHeader]} fixed>
        <Cell text={l.date} width={fixedWidths.date} bold />
        <Cell text={l.expense} width={fixedWidths.title} bold />
        <Cell text={l.payer} width={fixedWidths.payer} bold />
        <Cell text={l.amount} width={fixedWidths.amount} align="right" bold />
        {payload.members.map((m) => (
          <Cell key={m.id} text={m.displayName} width={shareWidth} align="right" bold />
        ))}
      </View>
      {payload.expenses.map((e, idx) => (
        <View key={idx} style={[styles.row, idx % 2 ? styles.zebra : {}]} wrap={false}>
          <Cell text={e.date} width={fixedWidths.date} />
          <Cell text={e.title} width={fixedWidths.title} />
          <Cell text={e.payer} width={fixedWidths.payer} />
          <Cell text={e.amountText} width={fixedWidths.amount} align="right" />
          {payload.members.map((m) => (
            <Cell
              key={m.id}
              text={e.sharesText[m.displayName] ?? '0'}
              width={shareWidth}
              align="right"
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function SummaryTable({ payload, l }: { payload: ExportPayload; l: PdfLabels }) {
  const widths = ['34%', '22%', '22%', '22%'];
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.rowHeader]} fixed>
        <Cell text={l.member} width={widths[0]!} bold />
        <Cell text={l.paid} width={widths[1]!} align="right" bold />
        <Cell text={l.owed} width={widths[2]!} align="right" bold />
        <Cell text={l.net} width={widths[3]!} align="right" bold />
      </View>
      {payload.summary.map((s, idx) => (
        <View key={idx} style={styles.row} wrap={false}>
          <Cell text={s.member} width={widths[0]!} />
          <Cell text={s.paidText} width={widths[1]!} align="right" />
          <Cell text={s.owedText} width={widths[2]!} align="right" />
          <Cell text={s.netText} width={widths[3]!} align="right" color={moneyColor(s.net)} />
        </View>
      ))}
    </View>
  );
}

function MemberExpenseDetails({
  member,
  expenses,
  l,
}: {
  member: ExportRowMember;
  expenses: ExportRowExpense[];
  l: PdfLabels;
}) {
  const rows = expenses
    .map((e) => ({
      date: e.date,
      title: e.title,
      payer: e.payer,
      share: e.sharesText[member.member] ?? '0',
      amount: e.shares[member.member] ?? 0,
    }))
    .filter((r) => r.amount > 0);

  return (
    <View style={styles.detailBlock} wrap={false}>
      <View style={styles.detailHeader}>
        <Text style={{ fontWeight: 700 }}>{member.member}</Text>
        <Text style={styles.muted}>{`${l.totalShare}: ${member.owedText}`}</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={[styles.empty, { paddingHorizontal: 6 }]}>{l.noSharedExpenses}</Text>
      ) : (
        rows.map((r, idx) => (
          <View key={idx} style={styles.detailRow}>
            <Cell text={r.date} width="12%" />
            <Cell text={r.title} width="46%" />
            <Cell text={r.payer} width="20%" />
            <Cell text={r.share} width="22%" align="right" />
          </View>
        ))
      )}
    </View>
  );
}

function TransfersTable({ payload, l }: { payload: ExportPayload; l: PdfLabels }) {
  if (payload.transfers.length === 0) {
    return <Text style={styles.empty}>{l.allSettled}</Text>;
  }
  const widths = ['40%', '40%', '20%'];
  return (
    <View style={styles.table}>
      <View style={[styles.row, styles.rowHeader]} fixed>
        <Cell text={l.from} width={widths[0]!} bold />
        <Cell text={l.to} width={widths[1]!} bold />
        <Cell text={l.amount} width={widths[2]!} align="right" bold />
      </View>
      {payload.transfers.map((t, idx) => (
        <View key={idx} style={styles.row} wrap={false}>
          <Cell text={t.from} width={widths[0]!} />
          <Cell text={t.to} width={widths[1]!} />
          <Cell text={t.amountText} width={widths[2]!} align="right" />
        </View>
      ))}
    </View>
  );
}

export async function buildPdf(payload: ExportPayload): Promise<Buffer> {
  const fontFamily = ensurePdfFont();
  const locale = payload.meta.locale || 'en-US';
  const l = labels(locale);
  const generated = formatGenerated(payload.meta.generatedAt, locale);

  const doc = (
    <Document>
      <Page size="A4" orientation="landscape" style={[styles.page, { fontFamily }]}>
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.h1}>{payload.meta.groupName}</Text>
            <Text style={styles.meta}>{`${l.generated}: ${generated}`}</Text>
          </View>
          <Text
            style={styles.badge}
          >{`${l.defaultCurrency}: ${payload.meta.defaultCurrency}`}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{l.expenses}</Text>
          <ExpensesTable payload={payload} l={l} />
        </View>

        <View style={styles.section} break>
          <Text style={styles.sectionTitle}>{l.summary}</Text>
          <SummaryTable payload={payload} l={l} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{l.transfers}</Text>
          <TransfersTable payload={payload} l={l} />
        </View>
      </Page>

      {payload.summary.map((member) => (
        <Page
          key={member.member}
          size="A4"
          orientation="landscape"
          style={[styles.page, { fontFamily }]}
        >
          <View style={styles.header} fixed>
            <View>
              <Text style={styles.h1}>{payload.meta.groupName}</Text>
              <Text style={styles.meta}>{`${l.memberDetails}: ${member.member}`}</Text>
            </View>
            <Text
              style={styles.badge}
            >{`${l.defaultCurrency}: ${payload.meta.defaultCurrency}`}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{`${l.memberDetails} · ${member.member}`}</Text>
            <SummaryTable
              payload={{
                ...payload,
                summary: [member],
              }}
              l={l}
            />
            <MemberExpenseDetails member={member} expenses={payload.expenses} l={l} />
          </View>
        </Page>
      ))}
    </Document>
  );
  return renderToBuffer(doc);
}
