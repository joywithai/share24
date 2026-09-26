import * as React from 'react';

import { cn } from '@/lib/utils';

const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  // UI primitive — every usage passes htmlFor (or wraps the control), but
  // the linter cannot see through the component boundary.
  // biome-ignore lint/a11y/noLabelWithoutControl: usage always associates a control
  <label
    ref={ref}
    className={cn('text-sm font-medium text-sub', className)}
    {...props}
  />
));
Label.displayName = 'Label';

export { Label };
