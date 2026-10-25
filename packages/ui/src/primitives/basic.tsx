import type { ComponentProps } from 'react';

/** Joins class names. Later classes do not override earlier ones (tailwind-merge is not approved). */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

/** 07 §8: 3 px ring in --ring with a 2 px offset, keyboard focus only. */
export const focusRing =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** 07 §7: 200 ms ease-out on opacity only, instant with reduced motion. */
export const motion = 'transition-opacity duration-200 ease-out motion-reduce:transition-none';

const buttonVariants = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90 active:opacity-80',
  secondary: 'border border-input bg-card text-foreground hover:opacity-80',
  ghost: 'bg-transparent text-foreground hover:opacity-70',
  destructive: 'bg-destructive text-primary-foreground hover:opacity-90 active:opacity-80',
  link: 'text-link underline underline-offset-4 hover:opacity-80',
} as const;

export type ButtonVariant = keyof typeof buttonVariants;
export type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: 'default' | 'icon';
};

export function Button({
  className,
  variant = 'primary',
  size = 'default',
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      data-slot="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control text-body font-medium',
        'disabled:pointer-events-none disabled:opacity-50',
        motion,
        focusRing,
        buttonVariants[variant],
        size === 'icon' ? 'size-11' : 'min-h-11 px-4',
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'min-h-11 w-full rounded-control border border-input bg-card px-3 text-body text-foreground',
        'placeholder:text-muted-foreground disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-card border border-border bg-card text-foreground', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="card-header" className={cn('grid gap-1 p-6 pb-0', className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('text-card-title', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('p-6', className)} {...props} />;
}

/** Status tones (07 §3): token at 10 % behind token-colored text. Tone is never the only signal. */
export const badgeTones = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-info/10 text-info',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
} as const;

export type BadgeTone = keyof typeof badgeTones;

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      data-slot="badge"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 rounded-control px-2 py-0.5 text-meta',
        badgeTones[tone],
        className,
      )}
      {...props}
    />
  );
}

const alertTones = {
  neutral: 'text-foreground',
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
} as const;

export function Alert({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'div'> & { tone?: BadgeTone }) {
  return (
    <div
      role="alert"
      data-slot="alert"
      data-tone={tone}
      className={cn(
        'grid gap-1 rounded-card border border-border bg-card p-4',
        alertTones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('font-medium', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('text-meta text-foreground', className)}
      {...props}
    />
  );
}

/** Real table semantics (07 §6); the wrapper scrolls so the page never scrolls sideways. */
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div data-slot="table-container" className="w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full text-body', className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('bg-muted', className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr data-slot="table-row" className={cn('border-b border-border', className)} {...props} />
  );
}

export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn('px-3 py-2 text-left text-meta text-muted-foreground', className)}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-3 py-2', className)} {...props} />;
}
