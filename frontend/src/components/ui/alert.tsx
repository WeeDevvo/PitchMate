import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { AlertCircleIcon, CheckCircle2Icon, InfoIcon, AlertTriangleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground",
  {
    variants: {
      variant: {
        default: "bg-background text-foreground",
        success:
          "border-green-500/50 text-green-900 dark:border-green-500/50 [&>svg]:text-green-600 bg-green-50 dark:bg-green-950 dark:text-green-50 dark:[&>svg]:text-green-400",
        destructive:
          "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive bg-destructive/10",
        warning:
          "border-yellow-500/50 text-yellow-900 dark:border-yellow-500/50 [&>svg]:text-yellow-600 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-50 dark:[&>svg]:text-yellow-400",
        info: "border-blue-500/50 text-blue-900 dark:border-blue-500/50 [&>svg]:text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-50 dark:[&>svg]:text-blue-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, children, ...props }, ref) => {
  const Icon = {
    default: InfoIcon,
    success: CheckCircle2Icon,
    destructive: AlertCircleIcon,
    warning: AlertTriangleIcon,
    info: InfoIcon,
  }[variant || "default"]

  return (
    <div
      ref={ref}
      role="alert"
      data-slot="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      <Icon className="size-4" />
      {children}
    </div>
  )
})
Alert.displayName = "Alert"

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    data-slot="alert-title"
    className={cn("mb-1 font-medium leading-none tracking-tight", className)}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="alert-description"
    className={cn("text-sm [&_p]:leading-relaxed", className)}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

export { Alert, AlertTitle, AlertDescription }
