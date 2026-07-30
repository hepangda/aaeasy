import { formatMoney } from '@aaeasy/core';
import puppeteer from '@cloudflare/puppeteer';
import type { Context } from 'hono';
import type { AppEnv } from '../app-env';
import { loadLedger } from '../services/ledger';

type Ledger = NonNullable<Awaited<ReturnType<typeof loadLedger>>>;

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function labels(locale: string) {
  const chinese = locale.toLowerCase().startsWith('zh');
  return chinese
    ? {
        generated: '生成时间',
        currency: '默认币种',
        expenses: '费用明细',
        date: '日期',
        title: '事由',
        payer: '垫付者',
        amount: '金额',
        split: '分摊',
        summary: '成员汇总',
        member: '成员',
        paid: '实付',
        owed: '应付',
        net: '净额',
        adjusted: '结算后净额',
        transfers: '建议转账',
        from: '付款人',
        to: '收款人',
        noTransfers: '当前无需转账',
        details: '成员分摊明细',
      }
    : {
        generated: 'Generated',
        currency: 'Default currency',
        expenses: 'Expenses',
        date: 'Date',
        title: 'Title',
        payer: 'Payer',
        amount: 'Amount',
        split: 'Split',
        summary: 'Member summary',
        member: 'Member',
        paid: 'Paid',
        owed: 'Owed',
        net: 'Net',
        adjusted: 'Adjusted net',
        transfers: 'Suggested transfers',
        from: 'From',
        to: 'To',
        noTransfers: 'No transfer is needed',
        details: 'Member split details',
      };
}

export function renderLedgerHtml(ledger: Ledger, locale: string): string {
  const text = labels(locale);
  const memberById = new Map(ledger.members.map((member) => [member.id, member]));
  const activeExpenses = ledger.expenses.filter((expense) => expense.amountMinor !== null);
  const expenseRows = activeExpenses
    .map((expense) => {
      const splitText = expense.splits
        .filter((split) => split.shareMinor > 0n)
        .map(
          (split) =>
            `${escapeHtml(memberById.get(split.memberId)?.displayName ?? '?')}: ${escapeHtml(
              formatMoney(split.shareMinor, expense.currency, locale),
            )}`,
        )
        .join('<br>');
      return `<tr>
        <td>${escapeHtml(new Intl.DateTimeFormat(locale).format(expense.occurredAt))}</td>
        <td><strong>${escapeHtml(expense.title)}</strong>${expense.note ? `<div class="muted">${escapeHtml(expense.note)}</div>` : ''}</td>
        <td>${escapeHtml(memberById.get(expense.payerMemberId)?.displayName ?? '?')}</td>
        <td class="money">${escapeHtml(formatMoney(expense.amountMinor!, expense.currency, locale))}</td>
        <td class="split">${splitText}</td>
      </tr>`;
    })
    .join('');
  const summaryRows = ledger.summary
    .map((summary) => {
      const tone =
        summary.adjustedNetMinorInGroup > 0n
          ? 'positive'
          : summary.adjustedNetMinorInGroup < 0n
            ? 'negative'
            : '';
      return `<tr>
        <td>${escapeHtml(memberById.get(summary.memberId)?.displayName ?? '?')}</td>
        <td class="money">${escapeHtml(formatMoney(summary.paidMinorInGroup, ledger.group.defaultCurrency, locale))}</td>
        <td class="money">${escapeHtml(formatMoney(summary.owedMinorInGroup, ledger.group.defaultCurrency, locale))}</td>
        <td class="money">${escapeHtml(formatMoney(summary.netMinorInGroup, ledger.group.defaultCurrency, locale))}</td>
        <td class="money ${tone}">${escapeHtml(formatMoney(summary.adjustedNetMinorInGroup, ledger.group.defaultCurrency, locale))}</td>
      </tr>`;
    })
    .join('');
  const transferRows =
    ledger.transfers.length === 0
      ? `<tr><td colspan="3" class="muted">${text.noTransfers}</td></tr>`
      : ledger.transfers
          .map(
            (transfer) => `<tr>
              <td>${escapeHtml(memberById.get(transfer.from)?.displayName ?? '?')}</td>
              <td>${escapeHtml(memberById.get(transfer.to)?.displayName ?? '?')}</td>
              <td class="money">${escapeHtml(formatMoney(transfer.amountMinor, ledger.group.defaultCurrency, locale))}</td>
            </tr>`,
          )
          .join('');
  const memberDetails = ledger.members
    .map((member) => {
      const rows = activeExpenses
        .flatMap((expense) => {
          const split = expense.splits.find((candidate) => candidate.memberId === member.id);
          if (!split || split.shareMinor <= 0n) return [];
          return [
            `<tr>
              <td>${escapeHtml(new Intl.DateTimeFormat(locale).format(expense.occurredAt))}</td>
              <td>${escapeHtml(expense.title)}</td>
              <td>${escapeHtml(memberById.get(expense.payerMemberId)?.displayName ?? '?')}</td>
              <td class="money">${escapeHtml(formatMoney(split.shareMinor, expense.currency, locale))}</td>
            </tr>`,
          ];
        })
        .join('');
      return `<section class="member-page">
        <h2>${escapeHtml(text.details)} · ${escapeHtml(member.displayName)}</h2>
        <table><thead><tr><th>${text.date}</th><th>${text.title}</th><th>${text.payer}</th><th>${text.amount}</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="muted">—</td></tr>`}</tbody></table>
      </section>`;
    })
    .join('');

  return `<!doctype html>
  <html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 11mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif; font-size: 9px; }
    header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 10px; border-bottom: 1px solid #d7dde5; }
    h1 { margin: 0 0 4px; font-size: 22px; } h2 { margin: 0 0 8px; font-size: 14px; }
    .badge { border: 1px solid #d7dde5; border-radius: 5px; background: #f1f5f9; padding: 6px 9px; }
    .meta, .muted { color: #64748b; } .section { margin-top: 12px; break-inside: avoid; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; } th { background: #f1f5f9; text-align: left; font-weight: 700; }
    th, td { border: 1px solid #d7dde5; padding: 5px 6px; vertical-align: top; overflow-wrap: anywhere; }
    tbody tr:nth-child(even) { background: #fbfdff; } .money { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .split { font-size: 8px; line-height: 1.45; } .positive { color: #047857; } .negative { color: #b91c1c; }
    .member-page { break-before: page; } .member-page table { font-size: 9px; }
    .expenses th:nth-child(1) { width: 10%; } .expenses th:nth-child(2) { width: 25%; }
    .expenses th:nth-child(3) { width: 12%; } .expenses th:nth-child(4) { width: 15%; } .expenses th:nth-child(5) { width: 38%; }
  </style></head><body>
    <header><div><h1>${escapeHtml(ledger.group.name)}</h1><div class="meta">${text.generated}: ${escapeHtml(new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()))}</div></div><div class="badge">${text.currency}: ${escapeHtml(ledger.group.defaultCurrency)}</div></header>
    <section class="section"><h2>${text.expenses}</h2><table class="expenses"><thead><tr><th>${text.date}</th><th>${text.title}</th><th>${text.payer}</th><th>${text.amount}</th><th>${text.split}</th></tr></thead><tbody>${expenseRows}</tbody></table></section>
    <section class="section"><h2>${text.summary}</h2><table><thead><tr><th>${text.member}</th><th>${text.paid}</th><th>${text.owed}</th><th>${text.net}</th><th>${text.adjusted}</th></tr></thead><tbody>${summaryRows}</tbody></table></section>
    <section class="section"><h2>${text.transfers}</h2><table><thead><tr><th>${text.from}</th><th>${text.to}</th><th>${text.amount}</th></tr></thead><tbody>${transferRows}</tbody></table></section>
    ${memberDetails}
  </body></html>`;
}

export async function createLedgerPdf(c: Context<AppEnv>, ledger: Ledger, locale: string) {
  const browser = await puppeteer.launch(c.env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(renderLedgerHtml(ledger, locale), { waitUntil: 'load' });
    await page.emulateMediaType('print');
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      waitForFonts: true,
    });
    const bytes = new Uint8Array(pdf.byteLength);
    bytes.set(pdf);
    return bytes.buffer;
  } finally {
    await browser.close();
  }
}
