import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative inline-flex">
      <select
        ref={ref}
        className={cn(
          'flex h-10 w-full appearance-none rounded-md border border-input bg-white/80 px-3 py-2 pr-9 text-sm text-foreground shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06)] focus-visible:outline-none focus-visible:border-primary/40 focus-visible:shadow-[inset_0_1px_2px_0_rgba(26,26,26,0.06),0_0_0_3px_rgba(212,82,46,0.1)] focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
});
Select.displayName = 'Select';

export { Select };
