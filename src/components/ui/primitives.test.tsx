// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AmountRow, toneForAmount } from './amount-row';
import { Card, CardBody, CardHeader } from './card';
import { Eyebrow } from './eyebrow';
import { EmptyState } from './empty-state';

describe('Card', () => {
  it('uses the spec radius and no shadow', () => {
    const { container } = render(
      <Card>
        <CardBody>body</CardBody>
      </Card>,
    );
    const card = container.firstElementChild!;
    expect(card).toHaveClass('rounded-2xl', 'border');
    expect(card.className).not.toMatch(/shadow-(soft|md)/);
  });

  it('renders header title and action slots', () => {
    render(
      <Card>
        <CardHeader title="Trip to Osaka" action={<button type="button">Settle</button>} />
      </Card>,
    );
    expect(screen.getByText('Trip to Osaka')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settle' })).toBeInTheDocument();
  });

  it('only applies body padding when asked', () => {
    const { container: none } = render(<Card>x</Card>);
    expect(none.firstElementChild).not.toHaveClass('p-5');

    const { container: padded } = render(<Card padding="body">x</Card>);
    expect(padded.firstElementChild).toHaveClass('p-5');
  });
});

describe('Eyebrow', () => {
  it('renders the one sanctioned micro-label spec', () => {
    render(<Eyebrow>Balance</Eyebrow>);
    const el = screen.getByText('Balance');
    expect(el).toHaveClass('text-[10px]', 'font-bold', 'tracking-[0.13em]', 'uppercase');
  });

  it('supports a chip variant with a tone', () => {
    render(
      <Eyebrow variant="chip" tone="signal">
        Archived
      </Eyebrow>,
    );
    expect(screen.getByText('Archived')).toHaveClass('rounded-md', 'bg-signal/20');
  });
});

describe('AmountRow', () => {
  it('renders amounts in a monospace face', () => {
    render(<AmountRow label="Zehao" amount="+¥222" tone="positive" />);
    const amount = screen.getByText('+¥222');
    expect(amount).toHaveClass('font-mono');
    expect(amount).toHaveClass('text-positive-ink');
  });

  it('derives tone from a signed amount so colour is never the only signal', () => {
    expect(toneForAmount(5n)).toBe('positive');
    expect(toneForAmount(-5n)).toBe('negative');
    expect(toneForAmount(0n)).toBe('muted');
    expect(toneForAmount(1.5)).toBe('positive');
  });
});

describe('EmptyState', () => {
  it('renders a heading and action at page level', () => {
    render(<EmptyState title="No groups yet" action={<button type="button">New</button>} />);
    expect(screen.getByRole('heading', { name: 'No groups yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('demotes the heading when compact, for use inside a card', () => {
    render(<EmptyState compact title="No expenses" />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('No expenses')).toBeInTheDocument();
  });
});
