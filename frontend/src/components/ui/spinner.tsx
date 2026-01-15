import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const spinnerVariants = cva(
  "inline-block animate-spin rounded-full border-solid border-current border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]",
  {
    variants: {
      size: {
        sm: "size-4 border-2",
        default: "size-6 border-2",
        lg: "size-8 border-[3px]",
        xl: "size-12 border-4",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

interface SpinnerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof spinnerVariants> {
  label?: string
}

function Spinner({ className, size, label = "Loading...", ...props }: SpinnerProps) {
  return (
    <div
      role="status"
      data-slot="spinner"
      className={cn(spinnerVariants({ size }), className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
    </div>
  )
}

export { Spinner, spinnerVariants }
