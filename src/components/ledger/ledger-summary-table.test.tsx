// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IntlProvider } from 'use-intl';
import messages from '../../../messages/en.json';
import { LedgerSummaryTable } from './ledger-summary-table';
import type { HydratedLedger, LedgerMember } from '@/spa/types';

function renderTable(hasSettlementEntries: boolean) {
  const members = [
    { id: 'm1', displayName: 'Zehao', color: null },
    { id: 'm2', displayName: 'Lin', color: null },
  ] as unknown as LedgerMember[];

  const summary = [
    {
      memberId: 'm1',
      paidMinorInGroup: 43800n,
      owedMinorInGroup: 21600n,
      netMinorInGroup: 22200n,
      adjustedNetMinorInGroup: 5400n,
    },
    {
      memberId: 'm2',
      paidMinorInGroup: 0n,
      owedMinorInGroup: 16800n,
      netMinorInGroup: -16800n,
      adjustedNetMinorInGroup: -5400n,
    },
  ] as unknown as HydratedLedger['summary'];

  return render(
    <IntlProvider locale="en" messages={messages}>
      <LedgerSummaryTable
        summary={summary}
        members={members}
        currency="CNY"
        hasSettlementEntries={hasSettlementEntries}
      />
    </IntlProvider>,
  );
}

describe('LedgerSummaryTable', () => {
  it('renders every member exactly once — not once per breakpoint', () => {
    renderTable(false);
    // A duplicated mobile/desktop tree would return two nodes here.
    expect(screen.getByText('Zehao')).toBeInTheDocument();
    expect(screen.getByText('Lin')).toBeInTheDocument();
  });

  it('exposes the pre/post settlement pair at every width', () => {
    renderTable(true);
    // Regression guard: the old mobile list showed only the adjusted figure,
    // so phone users could not see what settlements had changed.
    expect(screen.getAllByText(/CNY.*222\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/CNY.*54\.00/).length).toBeGreaterThan(0);
  });

  it('renders negatives with a typographic minus', () => {
    renderTable(false);
    expect(screen.getByText(/−/)).toBeInTheDocument();
  });

  it('never forces horizontal scroll with a min-width table', () => {
    const { container } = renderTable(true);
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('[class*="min-w-["]')).toBeNull();
  });
});
