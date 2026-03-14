import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'border-border/80 bg-card text-card-foreground',
      success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
      destructive: 'border-rose-200 bg-rose-50 text-rose-900',
      warning: 'border-amber-200 bg-amber-50 text-amber-900',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

function Alert({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
