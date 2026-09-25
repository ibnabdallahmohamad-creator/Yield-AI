"use client"

import * as React from "react"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-4", className)} {...props} />
}

/** Underlined tab row (page sections). Scrolls sideways on narrow screens instead of wrapping. */
function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "scrollbar-none flex items-center gap-1 overflow-x-auto border-b [-ms-overflow-style:none] [scrollbar-width:none]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-11 shrink-0 items-center justify-center gap-2 px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none select-none after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 data-[state=active]:text-foreground data-[state=active]:after:bg-primary [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn("outline-none", className)} {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
