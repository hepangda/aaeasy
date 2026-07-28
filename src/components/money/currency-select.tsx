import { useEffect, useMemo, useState } from 'react';
import { COMMON_CURRENCIES } from '@aaeasy/contracts/money';
import { useLocale } from 'use-intl';
import { Select, type SelectProps } from '@/components/ui/select';

interface CurrencySelectProps extends Omit<SelectProps, 'children' | 'value'> {
  value: string;
  preferredCurrency?: string;
}

/**
 * Narrow viewports show the bare 3-letter code. The `CODE · Full Name` form
 * needs ~180px to be readable; on a 375px screen the select was reserving that
 * width beside the amount field only to render a truncated "USD · US Dol…".
 */
function useCompactCurrencyLabels() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return compact;
}

export function CurrencySelect({ value, preferredCurrency, ...props }: CurrencySelectProps) {
  const locale = useLocale();
  const displayNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'currency' });
    } catch {
      return null;
    }
  }, [locale]);
  const compact = useCompactCurrencyLabels();
  const currencies = [...new Set([preferredCurrency, value, ...COMMON_CURRENCIES].filter(Boolean))];

  return (
    <Select value={value} {...props}>
      {currencies.map((currency) => {
        const code = currency as string;
        const name = displayNames?.of(code);
        return (
          <option key={code} value={code}>
            {!compact && name && name !== code ? `${code} · ${name}` : code}
          </option>
        );
      })}
    </Select>
  );
}
