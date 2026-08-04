import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Container for irreversible operations (delete account, delete group, unlink).
 *
 * Extracted from two near-verbatim copies in the account page and the group
 * settings panel. Both had drifted into being *less* prominent than ordinary
 * cards — no background, no border emphasis — despite holding the most
 * dangerous actions on the page.
 */
export function DangerZone({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card tone="danger" padding="body" className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-destructive-ink tracking-title text-base font-bold">{title}</h2>
        {description && <p className="text-muted-foreground text-sm leading-6">{description}</p>}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>
    </Card>
  );
}
