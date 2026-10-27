import * as React from 'react'

import { cn } from '@/lib/utils'

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[112px] w-full bg-background/50 border border-border px-3.5 py-3 text-sm leading-relaxed text-foreground font-normal rounded-[9px] placeholder:text-muted/70 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 resize-y transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
