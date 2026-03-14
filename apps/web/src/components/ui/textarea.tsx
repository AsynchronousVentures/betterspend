import * as React from 'react';
import { cn } from '../../lib/utils';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-20 w-full rounded-md border border-input bg-white/80 px-3 py-2 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06)] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:border-primary/40 focus-visible:shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06),0_0_0_3px_rgba(212,82,46,0.1)] focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
