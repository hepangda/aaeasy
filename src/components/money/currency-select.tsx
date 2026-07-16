import { useMemo } from 'react';
import { COMMON_CURRENCIES } from '@aaeasy/contracts/money';
import { useLocale } from 'use-intl';
import { Select, type SelectProps } from '@/components/ui/select';

interface CurrencySelectProps extends Omit<SelectProps, 'children' | 'value'> {
  value: string;
  preferredCurrency?: string;
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
  const currencies = [...new Set([preferredCurrency, value, ...COMMON_CURRENCIES].filter(Boolean))];

  return (
    <Select value={value} {...props}>
      {currencies.map((currency) => {
        const code = currency as string;
        const name = displayNames?.of(code);
        return (
          <option key={code} value={code}>
            {name && name !== code ? `${code} · ${name}` : code}
          </option>
        );
      })}
    </Select>
  );
}
