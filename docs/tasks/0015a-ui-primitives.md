# 0015a: shadcn base primitives in packages/ui

Status: review
Ticket: P0-UI-02 (part a of 3) | Depends on: none (P0-UI-01, P0-I18N-01 merged) | Base commit: head of phase/0 | Branch: task/0015a-ui-primitives | PR base: phase/0
Executor: Haiku 5.5 | Fits one session: 30 tool calls, 60k tokens

## 1. Objective

Add React, Radix, Lucide and Sonner to `@shoebox/ui` and vendor the 15 shadcn-style base primitives (Button, Input, Label, Select, RadioGroup, Checkbox, Switch, Tabs, Card, Badge, Alert, Dialog, Sheet, Table, Toast) styled only with the 07 design tokens. Every later screen builds on these, so focus, 44 px targets and token colors are right once, everywhere.

## 2. Context

**How to work (strict):** every file is given in full. Write each file with ONE Write call, exactly as given. Do not re-read a file you just wrote. Do not explore the repo. Run each step's command and commit in the same Bash call (`git add -A && git commit -qm "0015a step k"`). For `package.json` and `tsconfig.json` you must Read the file once before the Write (tool rule); read nothing else.

**Test filter:** run one file as `pnpm --filter @shoebox/ui test <name>` (no `--`: with `--` vitest runs every file).

**Spec 07 §6 (pasted):** base primitives are **shadcn/ui on Radix** (accessible focus management, do not hand-roll focus logic). Icons: **Lucide** (`lucide-react`), 20 px, 1.5 stroke, no emoji. Toasts: **Sonner** via shadcn, variants success, warning, error. Tables: shadcn `Table`, real `<table>` semantics. "shadcn, Radix, Lucide, Sonner, TanStack Table and zod are approved by this file." React comes with the approved Next.js 15 stack (decisions.md 2026-10-17).

**Spec 07 §7–§8 (pasted):** transitions 150–250 ms ease-out, animate only `opacity` and `transform`; `prefers-reduced-motion` makes them instant. Focus: a 3 px ring in `--ring` with a 2 px offset, never removed. Targets ≥ 44 × 44 px.

**Spec M11 §8 (pasted):** shadcn primitives are copied into `packages/ui/src/primitives`, Radix-based.

**Choices made by the brief writer (do not change):**
- Not added: `class-variance-authority`, `clsx`, `tailwind-merge` (shadcn's usual helpers, not in decisions.md, rule 7). `cn()` below only joins class names; variants are plain object maps.
- Primitives are grouped into three files (plain HTML, Radix, overlays) to keep the change small.
- Radix comes from the single `radix-ui` package (`import { Dialog as DialogPrimitive } from 'radix-ui'`).
- No user-facing string lives in a primitive: Dialog/Sheet take `closeLabel`, Toaster takes `label`, callers pass `t('...')`. Tests use `t()` from `@shoebox/i18n`, never literal JSX text (Biome plugin `no-jsx-literal-text` covers `packages/ui/**`, tests included).
- No raw colors: only token classes (`bg-primary`, `text-muted-foreground`, `border-input`, `ring-ring`, `bg-success/10` …). `test/no-raw-colors.test.ts` scans these files.
- Sonner runs `unstyled` so its built-in hex colors never apply; our token classes do.
- Small controls (radio, checkbox, switch) reach 44 px with an invisible `after:` hit area.
- `@shoebox/domain` and `@shoebox/i18n` are added now (used in 0015b) so 0015b needs no lockfile change.
- Dependency versions are exact and ≥ 14 days old on 2026-10-18 (checked with `npm view <pkg> time`): react / react-dom 19.3.0, @types/react / @types/react-dom 19.3.0, radix-ui 1.6.7, lucide-react 1.51.0, sonner 2.0.8.
- Icon names verified in lucide-react 1.51.0: `Check`, `ChevronDown`, `Circle`, `X`.
- Vite 8 (used by Vitest 4.1) reads `"jsx": "react-jsx"` from the package tsconfig, so `.tsx` tests need no vitest config change.

Hard rules: 6 (tokens only, every string through i18n), 7 (no dependency beyond the list above).

## 3. Files

| Path | Action | What |
|---|---|---|
| `packages/ui/package.json` | edit (full content) | React, Radix, Lucide, Sonner, workspace deps, React types |
| `pnpm-lock.yaml` | generated | by `pnpm install` |
| `packages/ui/tsconfig.json` | edit (full content) | DOM lib, `jsx: react-jsx` |
| `packages/ui/src/primitives/basic.tsx` | new | `cn`, Button, Input, Card, Badge, Alert, Table |
| `packages/ui/src/primitives/radix.tsx` | new | Label, Select, RadioGroup, Checkbox, Switch, Tabs |
| `packages/ui/src/primitives/overlay.tsx` | new | Dialog, Sheet, Toaster/toast |
| `packages/ui/src/index.ts` | edit (full content) | re-export primitives |
| `packages/ui/test/render.tsx` | new | tiny React render helper (no testing-library) |
| `packages/ui/test/primitives.test.tsx` | new | renders each primitive |

No other file may change.

## 4. Steps

Setup (no file): `cd /home/user/leonoperations && git fetch origin phase/0 && git checkout -b task/0015a-ui-primitives origin/phase/0 && pnpm install --frozen-lockfile 2>&1 | tail -3`. Expected: `Switched to a new branch`, then `Done in …`.

**Step 1: `packages/ui/package.json`.** Read it, then Write exactly:

```json
{
  "name": "@shoebox/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Design system components and tokens (07).",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    },
    "./fonts": {
      "types": "./src/fonts.ts",
      "default": "./src/fonts.ts"
    },
    "./tokens.css": "./src/tokens.css",
    "./theme.css": "./src/theme.css"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run --environment happy-dom"
  },
  "dependencies": {
    "@shoebox/domain": "workspace:*",
    "@shoebox/i18n": "workspace:*",
    "lucide-react": "1.51.0",
    "radix-ui": "1.6.7",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "sonner": "2.0.8"
  },
  "devDependencies": {
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "happy-dom": "catalog:",
    "tailwindcss": "4.3.3",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Command: `pnpm install 2>&1 | tail -5`. Expected: `Done in …`, no `ERR_PNPM`. Commit (includes `pnpm-lock.yaml`).

**Step 2: `packages/ui/tsconfig.json`.** Read it, then Write exactly:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": ".",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src", "test"]
}
```

Command: `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -5`. Expected: no `error TS`.

**Step 3: `packages/ui/src/primitives/basic.tsx` (new).**

```tsx
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

export function Button({ className, variant = 'primary', size = 'default', ...props }: ButtonProps) {
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
  return <div data-slot="card-header" className={cn('grid gap-1 p-6 pb-0', className)} {...props} />;
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
  return <tr data-slot="table-row" className={cn('border-b border-border', className)} {...props} />;
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
```

Command: none (typecheck at step 6). Commit.

**Step 4: `packages/ui/src/primitives/radix.tsx` (new).**

```tsx
import { Check, ChevronDown, Circle } from 'lucide-react';
import {
  Checkbox as CheckboxPrimitive,
  Label as LabelPrimitive,
  RadioGroup as RadioGroupPrimitive,
  Select as SelectPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
} from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn, focusRing, motion } from './basic';

/** Invisible hit area that grows a 20 px control to 44 px (07 §8 targets). */
const hitArea = 'relative after:absolute after:-inset-3';

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-meta font-medium text-foreground', className)}
      {...props}
    />
  );
}

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        'flex min-h-11 w-full items-center justify-between gap-2 rounded-control border border-input bg-card px-3 text-body text-foreground',
        'disabled:opacity-50',
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={20} strokeWidth={1.5} aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position="popper"
        sideOffset={4}
        className={cn(
          'z-50 min-w-32 rounded-control border border-border bg-card text-foreground shadow-md',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex min-h-11 cursor-default select-none items-center rounded-control py-2 pr-2 pl-8 text-body outline-none',
        'data-[highlighted]:bg-muted data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check size={16} strokeWidth={1.5} aria-hidden="true" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-4', className)}
      {...props}
    />
  );
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'size-5 shrink-0 rounded-full border border-input bg-card text-primary disabled:opacity-50',
        hitArea,
        focusRing,
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <Circle size={10} className="fill-current" aria-hidden="true" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'size-5 shrink-0 rounded-control border border-input bg-card disabled:opacity-50',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        hitArea,
        focusRing,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check size={16} strokeWidth={2} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-muted p-0.5 disabled:opacity-50',
        'data-[state=checked]:bg-primary',
        'relative after:absolute after:-inset-y-2.5 after:inset-x-0',
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'block size-4 rounded-full bg-card shadow transition-transform duration-200 ease-out motion-reduce:transition-none',
          'data-[state=checked]:translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export const Tabs = TabsPrimitive.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex gap-1 rounded-control bg-muted p-1', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'min-h-11 rounded-control px-3 text-meta font-medium text-muted-foreground',
        'data-[state=active]:bg-card data-[state=active]:text-foreground',
        motion,
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('pt-4', focusRing, className)}
      {...props}
    />
  );
}
```

Command: none. Commit.

**Step 5: `packages/ui/src/primitives/overlay.tsx` (new).**

```tsx
import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { Toaster as SonnerToaster, toast } from 'sonner';
import { Button, cn } from './basic';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;

/** closeLabel: the close button's accessible name, from t() (no strings in packages/ui). */
type ContentProps = ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string };

function Overlay() {
  return (
    <DialogPrimitive.Overlay data-slot="dialog-overlay" className="fixed inset-0 z-50 bg-background/80" />
  );
}

function CloseButton({ label }: { label: string }) {
  return (
    <DialogPrimitive.Close asChild>
      <Button variant="ghost" size="icon" aria-label={label} className="absolute top-2 right-2">
        <X size={20} strokeWidth={1.5} aria-hidden="true" />
      </Button>
    </DialogPrimitive.Close>
  );
}

export function DialogContent({ className, children, closeLabel, ...props }: ContentProps) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
          'rounded-card border border-border bg-card p-6 text-foreground shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
        <CloseButton label={closeLabel} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('pr-12 text-section text-foreground', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-body text-muted-foreground', className)}
      {...props}
    />
  );
}

export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;

const sheetSides = {
  right: 'inset-y-0 right-0 h-full w-3/4 max-w-sm border-l',
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-card border-t',
} as const;

export type SheetSide = keyof typeof sheetSides;

export function SheetContent({
  className,
  children,
  closeLabel,
  side = 'right',
  ...props
}: ContentProps & { side?: SheetSide }) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          'fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-card p-6 text-foreground shadow-lg',
          sheetSides[side],
          className,
        )}
        {...props}
      >
        {children}
        <CloseButton label={closeLabel} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export { toast };

/** Sonner, unstyled so only token classes apply (its built-in palette has raw colors). label: from t(). */
export function Toaster({
  label,
  ...props
}: Omit<ComponentProps<typeof SonnerToaster>, 'containerAriaLabel'> & { label: string }) {
  return (
    <SonnerToaster
      containerAriaLabel={label}
      position="bottom-center"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-full items-center gap-3 rounded-card border border-border bg-card p-4 text-body text-foreground shadow-lg',
          success: 'text-success',
          warning: 'text-warning',
          error: 'text-destructive',
          actionButton: 'min-h-11 rounded-control px-3 font-medium text-link underline',
        },
      }}
      {...props}
    />
  );
}
```

Command: none. Commit.

**Step 6: `packages/ui/src/index.ts`.** Read it, then Write exactly:

```ts
export const packageName = '@shoebox/ui' as const;

export * from './primitives/basic';
export * from './primitives/overlay';
export * from './primitives/radix';
```

Command: `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -15`. Expected: no `error TS`. One fix allowed in a `src/primitives` file (keep every export name and prop); a second failure: STOP. Commit.

**Step 7: `packages/ui/test/render.tsx` (new).**

```tsx
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// Tells React this is a test, so act() flushes renders and effects synchronously.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; container: HTMLElement }> = [];

/** Renders into a fresh div in document.body. Portals (Dialog, Select) render into body too. */
export function render(ui: ReactNode): { container: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return { container };
}

/** Unmounts everything render() mounted; use as afterEach(cleanup). */
export function cleanup(): void {
  for (const { root, container } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
  document.body.replaceChildren();
}
```

Command: none. Commit.

**Step 8: `packages/ui/test/primitives.test.tsx` (new).** Implement until these tests pass; do not edit the test file.

```tsx
import { t } from '@shoebox/i18n';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toaster,
} from '../src/index';
import { cleanup, render } from './render';

afterEach(cleanup);

// Any catalog strings: tests never use literal JSX text (lint rule no-jsx-literal-text).
const word = t('doc.confirm');
const other = t('manual.add');

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, undefined, 'b', null)).toBe('a b');
  });
});

describe('Button', () => {
  it('is a type=button with token classes, 44 px and a focus ring', () => {
    const { container } = render(<Button>{word}</Button>);
    const button = container.querySelector('button');
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.textContent).toBe(word);
    const cls = button?.className ?? '';
    expect(cls).toContain('bg-primary');
    expect(cls).toContain('min-h-11');
    expect(cls).toContain('focus-visible:ring-ring');
    expect(cls).toContain('motion-reduce:transition-none');
  });

  it('has a destructive variant and an icon size', () => {
    const { container } = render(
      <Button variant="destructive" size="icon" aria-label={word} type="submit" />,
    );
    const button = container.querySelector('button');
    expect(button?.className).toContain('bg-destructive');
    expect(button?.className).toContain('size-11');
    expect(button?.getAttribute('type')).toBe('submit');
  });
});

describe('Input and Label', () => {
  it('label points at the input', () => {
    const { container } = render(
      <>
        <Label htmlFor="f1">{word}</Label>
        <Input id="f1" />
      </>,
    );
    expect(container.querySelector('label')?.getAttribute('for')).toBe('f1');
    const input = container.querySelector('input');
    expect(input?.getAttribute('type')).toBe('text');
    expect(input?.className).toContain('border-input');
  });
});

describe('Radix controls', () => {
  it('Select renders a combobox trigger', () => {
    const { container } = render(
      <Select>
        <SelectTrigger aria-label={word}>
          <SelectValue placeholder={word} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">{word}</SelectItem>
        </SelectContent>
      </Select>,
    );
    const trigger = container.querySelector('[role="combobox"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
  });

  it('RadioGroup renders radios with the default checked', () => {
    const { container } = render(
      <RadioGroup defaultValue="a" aria-label={word}>
        <RadioGroupItem value="a" aria-label={word} />
        <RadioGroupItem value="b" aria-label={other} />
      </RadioGroup>,
    );
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
    const radios = container.querySelectorAll('[role="radio"]');
    expect(radios).toHaveLength(2);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    expect(radios[1]?.getAttribute('aria-checked')).toBe('false');
  });

  it('Checkbox and Switch expose their state', () => {
    const { container } = render(
      <>
        <Checkbox aria-label={word} defaultChecked />
        <Switch aria-label={other} />
      </>,
    );
    expect(container.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
  });

  it('Tabs render a tablist with the active tab and its panel', () => {
    const { container } = render(
      <Tabs defaultValue="a">
        <TabsList aria-label={word}>
          <TabsTrigger value="a">{word}</TabsTrigger>
          <TabsTrigger value="b">{other}</TabsTrigger>
        </TabsList>
        <TabsContent value="a">{word}</TabsContent>
        <TabsContent value="b">{other}</TabsContent>
      </Tabs>,
    );
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toBe(word);
  });
});

describe('static primitives', () => {
  it('Card, Badge, Alert and Table use tokens and real semantics', () => {
    const { container } = render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>{word}</CardTitle>
          </CardHeader>
          <CardContent>{other}</CardContent>
        </Card>
        <Badge tone="success">{word}</Badge>
        <Alert tone="destructive">
          <AlertTitle>{word}</AlertTitle>
          <AlertDescription>{other}</AlertDescription>
        </Alert>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{word}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>{other}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>,
    );
    expect(container.querySelector('[data-slot="card"]')?.className).toContain('rounded-card');
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('success');
    expect(badge?.className).toContain('text-success');
    expect(container.querySelector('[role="alert"]')?.className).toContain('text-destructive');
    expect(container.querySelector('table th')?.textContent).toBe(word);
    expect(container.querySelector('table td')?.textContent).toBe(other);
  });

  it('Badge defaults to the neutral tone', () => {
    const { container } = render(<Badge>{word}</Badge>);
    expect(container.querySelector('[data-slot="badge"]')?.getAttribute('data-tone')).toBe('neutral');
  });
});

describe('overlays', () => {
  it('an open Dialog renders a titled dialog with a labelled close button', () => {
    render(
      <Dialog open>
        <DialogContent closeLabel={other}>
          <DialogTitle>{word}</DialogTitle>
          <DialogDescription>{other}</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(word);
    expect(dialog?.querySelector(`button[aria-label="${other}"]`)).not.toBeNull();
  });

  it('an open Sheet renders on the chosen side', () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" closeLabel={other}>
          <SheetTitle>{word}</SheetTitle>
          <SheetDescription>{other}</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const sheet = document.body.querySelector('[data-slot="sheet-content"]');
    expect(sheet?.getAttribute('role')).toBe('dialog');
    expect(sheet?.getAttribute('data-side')).toBe('bottom');
    expect(sheet?.className).toContain('bottom-0');
  });

  it('Toaster renders a labelled live region', () => {
    render(<Toaster label={word} />);
    const region = document.body.querySelector('section[aria-live]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-label')?.startsWith(word)).toBe(true);
  });
});
```

Command: `pnpm --filter @shoebox/ui test primitives 2>&1 | tail -30`. Expected: `Tests  13 passed`. A failure: one fix in a `src/primitives` file, rerun; a second failure: STOP. Commit.

**Step 9: format and full checks (no new file).** `biome check --write` may reformat files, test files included; formatting-only changes are allowed. Command: `pnpm exec biome check --write packages/ui 2>&1 | tail -5 && pnpm --filter @shoebox/ui test 2>&1 | tail -8 && pnpm --filter @shoebox/ui typecheck 2>&1 | tail -5 && pnpm lint 2>&1 | tail -15`. Expected: all ui test files pass (including `no-raw-colors` and the existing `tokens`/`theme` tests), no `error TS`, lint ends without errors. If lint reports a rule error (not formatting) in a §3 file: one fix, rerun; again: STOP. Commit.

## 5. Do not touch

`packages/ui/src/tokens.css`, `theme.css`, `fonts.ts` and the existing tests; `packages/i18n/**`; `packages/domain/**`; `biome.json`; root `package.json`; `vitest.workspace.ts`; anything in `apps/`. Hard rules 6 and 7: no raw color, no literal JSX text, no dependency other than the ones in step 1.

## 6. Commands

- `pnpm --filter @shoebox/ui test primitives 2>&1 | tail -30` → 13 passed.
- `pnpm --filter @shoebox/ui test 2>&1 | tail -30` → all files pass.
- `pnpm --filter @shoebox/ui typecheck 2>&1 | tail -30` → no `error TS`.
- `pnpm lint 2>&1 | tail -30` → no errors.

(`test:a11y` comes in 0015c.)

## 7. Acceptance

- [ ] Primitives in `packages/ui/src/primitives`: Button, Input, Label, Select, RadioGroup, Checkbox, Switch, Tabs, Card, Badge, Alert, Dialog, Sheet, Table, Toast (`Toaster` + `toast`), all exported from `@shoebox/ui` (`test/primitives.test.tsx` passes).
- [ ] No raw colors (`no-raw-colors.test.ts` passes); Lucide icons only; focus ring and 44 px classes present (tested on Button).
- [ ] `pnpm --filter @shoebox/ui typecheck` and `pnpm lint` clean.
- Not in this brief: StatusBadge, MoneyText, LegalDateText (0015b); axe / `test:a11y` (0015c). No screen changes, so no screenshot.

## 8. Stop and ask

Stop, and write the report, if:

- an anchor or file is not as described;
- a test fails twice, or a test this brief wrote seems wrong;
- you reach 25 tool calls or about 50k tokens (report as `blocked`, see executor.md);
- `pnpm install` wants a different version or a package not in step 1;
- a file outside §3 needs a change;
- a step is unclear;
- you need push to `main`, merge, secrets, accounts or deploy.

## 9. Report

Write `docs/tasks/0015a-report.md` (600 tokens at most) and set `Status: review` here. Contents: `git diff --stat origin/phase/0`; each §6 command with its last 5 lines; §7 ticked; deviations; questions. Then `git add -A && git commit -qm "0015a report" && git push -u origin task/0015a-ui-primitives 2>&1 | tail -3`. The orchestrator opens and merges the PR.

## Risk list (for the reviewer)

- `packages/ui/package.json` and `pnpm-lock.yaml`: only the step 1 packages, exact versions.
- `overlay.tsx`: Sonner `unstyled`; close buttons labelled; no string literals.
- Any class with a raw color or a non-token color name (`black`, `white`, `gray-…`).

## Owner steps

None.
