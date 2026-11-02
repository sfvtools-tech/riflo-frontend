import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex resize-y min-h-11 w-full rounded-md box-border border border-solid border-input font-[inherit] text-foreground bg-background px-3 py-2.5 text-base shadow-xs motion-reduce:transition-none transition-[color,box-shadow] outline-none forced-colors:focus-visible:outline-solid forced-colors:focus-visible:outline-2 forced-colors:focus-visible:outline-offset-2 forced-colors:focus-visible:outline-[Highlight] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/50 aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/50 min-[601px]:text-sm dark:bg-background",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
