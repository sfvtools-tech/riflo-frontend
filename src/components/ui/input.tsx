import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-md box-border border border-solid border-input font-[inherit] text-foreground bg-background px-3 py-1 text-base shadow-xs motion-reduce:transition-none transition-[color,box-shadow] outline-none forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[Highlight] selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-background file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 min-[601px]:text-sm dark:bg-background",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/50 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
