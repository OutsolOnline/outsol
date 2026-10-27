import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap gap-2 font-medium text-sm tracking-normal transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        default: 'bg-accent text-background hover:bg-accent/90 rounded-[9px] shadow-sm',
        secondary: 'bg-surface text-foreground border border-border hover:border-muted-dim hover:bg-surface-elevated rounded-[9px]',
        ghost: 'bg-transparent text-muted hover:text-foreground hover:bg-surface rounded-[9px]',
        destructive: 'bg-destructive text-destructive-foreground hover:opacity-80 rounded-[9px]',
        link: 'text-muted underline-offset-4 hover:text-foreground hover:underline',
      },
      size: {
        default: 'h-11 px-5',
        sm: 'h-10 px-4 text-xs',
        lg: 'h-12 px-6',
        icon: 'h-10 w-10 rounded-[9px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
