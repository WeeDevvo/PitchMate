import { afterEach, expect } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { toHaveNoViolations } from 'jest-axe'

// Register jest-axe accessibility matchers.
expect.extend(toHaveNoViolations)

// Unmount React trees and clean up the DOM after every test.
afterEach(() => {
  cleanup()
})
