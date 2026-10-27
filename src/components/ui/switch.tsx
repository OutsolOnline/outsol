'use client'

import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'

import { cn } from '@/lib/utils'

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-terminal border border-border transition-all duration-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 data-[state=checked]:bg-foreground data-[state=unchecked]:bg-surface',
      className
    )}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
        'pointer-events-none block h-3 w-3 rounded-full bg-muted transition-transform duration-300 data-[state=checked]:translate-x-4 data-[state=checked]:bg-background data-[state=unchecked]:translate-x-1'
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
