import * as React from 'react'

import { cn } from '@/lib/utils'

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: 'line' | 'pill'
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = 'pill', ...props }, ref) => {
    const baseStyles = 'w-full text-sm text-foreground font-normal placeholder:text-muted/70 focus:outline-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40'
    
    const variantStyles = {
      line: 'bg-transparent border-0 border-b border-muted-dim px-0 py-3 focus:border-foreground focus:border-b-2 focus:pb-[11px]',
      pill: 'min-h-11 bg-background/50 border border-border px-3.5 py-2.5 rounded-[9px] focus:border-accent/50 focus:ring-2 focus:ring-accent/10',
    }

    return (
      <input
        type={type}
        className={cn(baseStyles, variantStyles[variant], className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
