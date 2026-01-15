import * as React from "react"
import { Button, buttonVariants } from "./button"
import { Spinner } from "./spinner"
import { cn } from "@/lib/utils"
import type { VariantProps } from "class-variance-authority"

interface LoadingButtonProps
  extends React.ComponentProps<typeof Button>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  loadingText?: string
}

function LoadingButton({
  children,
  loading = false,
  loadingText,
  disabled,
  className,
  ...props
}: LoadingButtonProps) {
  return (
    <Button
      disabled={disabled || loading}
      className={cn(className)}
      {...props}
    >
      {loading && <Spinner size="sm" />}
      {loading ? loadingText || children : children}
    </Button>
  )
}

export { LoadingButton }
