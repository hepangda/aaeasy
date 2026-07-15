import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="border-border bg-card flex flex-col gap-7 rounded-2xl border px-6 py-9 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-10">
      <div className="flex max-w-2xl items-start gap-4 sm:gap-5">
        {icon && (
          <div className="bg-secondary text-secondary-foreground grid size-11 shrink-0 place-items-center rounded-xl [&_svg]:size-5">
            {icon}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <h2 className="text-foreground text-xl leading-tight font-semibold tracking-[-0.025em] sm:text-2xl">
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground max-w-xl text-sm leading-6">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
    </section>
  );
}
