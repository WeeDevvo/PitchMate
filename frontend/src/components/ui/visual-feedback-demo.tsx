"use client"

import * as React from "react"
import { Button } from "./button"
import { LoadingButton } from "./loading-button"
import { Input } from "./input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card"
import { Alert, AlertDescription, AlertTitle } from "./alert"
import { Skeleton } from "./skeleton"
import { Progress } from "./progress"
import { Spinner } from "./spinner"
import { useToast } from "./use-toast"

/**
 * Visual Feedback Demo Component
 * 
 * This component demonstrates all visual feedback patterns:
 * - Hover states (automatic via CSS)
 * - Focus states (automatic via CSS with focus-visible)
 * - Active states (automatic via CSS)
 * - Loading states (Spinner, LoadingButton, Skeleton, Progress)
 * - Success/Error notifications (Toast, Alert)
 * 
 * Requirements: 12.5 - Visual feedback for interactions
 */
export function VisualFeedbackDemo() {
  const [loading, setLoading] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const { toast } = useToast()

  const handleLoadingClick = () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 2000)
  }

  const handleProgressClick = () => {
    setProgress(0)
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          return 100
        }
        return prev + 10
      })
    }, 200)
  }

  const showSuccessToast = () => {
    toast({
      variant: "success",
      title: "Success!",
      description: "Your action completed successfully.",
    })
  }

  const showErrorToast = () => {
    toast({
      variant: "destructive",
      title: "Error",
      description: "Something went wrong. Please try again.",
    })
  }

  const showDefaultToast = () => {
    toast({
      title: "Notification",
      description: "This is a default notification.",
    })
  }

  return (
    <div className="container py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold mb-2">Visual Feedback Demo</h1>
        <p className="text-muted-foreground">
          Demonstrating hover, focus, active, loading states, and notifications
        </p>
      </div>

      {/* Hover, Focus, and Active States */}
      <Card>
        <CardHeader>
          <CardTitle>Interactive States</CardTitle>
          <CardDescription>
            Hover over buttons, focus with Tab key, and click to see active states
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="default">Default Button</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="space-y-2">
            <Input placeholder="Focus me with Tab key" />
            <Input placeholder="Type to see active state" />
          </div>
        </CardContent>
      </Card>

      {/* Loading States */}
      <Card>
        <CardHeader>
          <CardTitle>Loading States</CardTitle>
          <CardDescription>
            Various loading indicators for different contexts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Spinner */}
          <div>
            <h3 className="text-sm font-medium mb-2">Spinner</h3>
            <div className="flex items-center gap-4">
              <Spinner size="sm" />
              <Spinner size="default" />
              <Spinner size="lg" />
              <Spinner size="xl" />
            </div>
          </div>

          {/* Loading Button */}
          <div>
            <h3 className="text-sm font-medium mb-2">Loading Button</h3>
            <LoadingButton
              loading={loading}
              onClick={handleLoadingClick}
              loadingText="Processing..."
            >
              Click to Load
            </LoadingButton>
          </div>

          {/* Progress Bar */}
          <div>
            <h3 className="text-sm font-medium mb-2">Progress Bar</h3>
            <div className="space-y-2">
              <Progress value={progress} />
              <Button onClick={handleProgressClick} size="sm">
                Start Progress
              </Button>
            </div>
          </div>

          {/* Skeleton Loaders */}
          <div>
            <h3 className="text-sm font-medium mb-2">Skeleton Loaders</h3>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Toast notifications and inline alerts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Toast Notifications */}
          <div>
            <h3 className="text-sm font-medium mb-2">Toast Notifications</h3>
            <div className="flex flex-wrap gap-2">
              <Button onClick={showSuccessToast} variant="default">
                Show Success
              </Button>
              <Button onClick={showErrorToast} variant="destructive">
                Show Error
              </Button>
              <Button onClick={showDefaultToast} variant="outline">
                Show Default
              </Button>
            </div>
          </div>

          {/* Inline Alerts */}
          <div>
            <h3 className="text-sm font-medium mb-2">Inline Alerts</h3>
            <div className="space-y-4">
              <Alert variant="success">
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>
                  Your changes have been saved successfully.
                </AlertDescription>
              </Alert>

              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  There was a problem processing your request.
                </AlertDescription>
              </Alert>

              <Alert variant="warning">
                <AlertTitle>Warning</AlertTitle>
                <AlertDescription>
                  Please review your information before proceeding.
                </AlertDescription>
              </Alert>

              <Alert variant="info">
                <AlertTitle>Information</AlertTitle>
                <AlertDescription>
                  This feature is currently in beta testing.
                </AlertDescription>
              </Alert>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Disabled States */}
      <Card>
        <CardHeader>
          <CardTitle>Disabled States</CardTitle>
          <CardDescription>
            Components in disabled state with reduced opacity
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button disabled>Disabled Button</Button>
            <Button disabled variant="outline">
              Disabled Outline
            </Button>
          </div>
          <Input disabled placeholder="Disabled input" />
        </CardContent>
      </Card>
    </div>
  )
}
