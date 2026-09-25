"use client"

import * as React from "react"
import { cn } from "cn"
import { Dialog as DialogPrimitive } from "radix-ui"

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogContent({
  className,
  children,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { overlayClassName?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-forest-900/20 duration-150 supports-backdrop-filter:backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
          overlayClassName
        )}
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-2xl border bg-popover text-popover-foreground shadow-2xl outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-[0.98] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-[0.98]",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("text-base font-semibold", className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description data-slot="dialog-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
  )
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger }
