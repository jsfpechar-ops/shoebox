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
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className="fixed inset-0 z-50 bg-background/80"
    />
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
