import { describe, it, expect } from 'vitest'

/**
 * Feature: pitchmate-core, Property 44: Color contrast compliance
 * 
 * For any UI element with text, the color contrast ratio should meet 
 * WCAG AA standards (minimum 4.5:1 for normal text, 3:1 for large text).
 * 
 * Validates: Requirements 12.6
 * 
 * This test validates that all color combinations in the design system
 * meet WCAG AA accessibility standards for color contrast.
 */

// Helper function to convert hex to RGB
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) {
    throw new Error(`Invalid hex color: ${hex}`)
  }
  return [
    parseInt(result[1], 16),
    parseInt(result[2], 16),
    parseInt(result[3], 16),
  ]
}

// Calculate relative luminance according to WCAG 2.1
function getRelativeLuminance(r: number, g: number, b: number): number {
  // Normalize RGB values to 0-1 range
  const [rs, gs, bs] = [r / 255, g / 255, b / 255]
  
  // Apply gamma correction
  const gammaCorrect = (val: number) => {
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4)
  }
  
  const rLinear = gammaCorrect(rs)
  const gLinear = gammaCorrect(gs)
  const bLinear = gammaCorrect(bs)
  
  // Calculate luminance using WCAG formula
  return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear
}

// Calculate contrast ratio according to WCAG 2.1
function getContrastRatio(color1: string, color2: string): number {
  const [r1, g1, b1] = hexToRgb(color1)
  const [r2, g2, b2] = hexToRgb(color2)
  
  const l1 = getRelativeLuminance(r1, g1, b1)
  const l2 = getRelativeLuminance(r2, g2, b2)
  
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  
  return (lighter + 0.05) / (darker + 0.05)
}

describe('Color Contrast Compliance (Property 44)', () => {
  describe('Light Mode Color Combinations', () => {
    const lightModeColors = {
      background: '#FFFFFF',      // oklch(1 0 0)
      foreground: '#252525',      // oklch(0.145 0 0)
      primary: '#343434',         // oklch(0.205 0 0)
      primaryForeground: '#FCFCFC', // oklch(0.985 0 0)
      secondary: '#F7F7F7',       // oklch(0.97 0 0)
      secondaryForeground: '#343434', // oklch(0.205 0 0)
      muted: '#F7F7F7',          // oklch(0.97 0 0)
      mutedForeground: '#8E8E8E', // oklch(0.556 0 0)
      accent: '#F7F7F7',         // oklch(0.97 0 0)
      accentForeground: '#343434', // oklch(0.205 0 0)
      destructive: '#E74C3C',     // oklch(0.577 0.245 27.325) - approximate
      border: '#EBEBEB',         // oklch(0.922 0 0)
      input: '#EBEBEB',          // oklch(0.922 0 0)
      ring: '#B5B5B5',           // oklch(0.708 0 0)
    }

    it('should have sufficient contrast for primary text on background', () => {
      const ratio = getContrastRatio(
        lightModeColors.foreground,
        lightModeColors.background
      )
      // Normal text requires 4.5:1 for WCAG AA
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for primary button text', () => {
      const ratio = getContrastRatio(
        lightModeColors.primaryForeground,
        lightModeColors.primary
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for secondary button text', () => {
      const ratio = getContrastRatio(
        lightModeColors.secondaryForeground,
        lightModeColors.secondary
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for muted text', () => {
      const ratio = getContrastRatio(
        lightModeColors.mutedForeground,
        lightModeColors.background
      )
      // Muted text should still meet minimum 4.5:1
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for destructive button text', () => {
      const ratio = getContrastRatio(
        '#FFFFFF',
        lightModeColors.destructive
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for accent text', () => {
      const ratio = getContrastRatio(
        lightModeColors.accentForeground,
        lightModeColors.accent
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('Dark Mode Color Combinations', () => {
    const darkModeColors = {
      background: '#252525',      // oklch(0.145 0 0)
      foreground: '#FCFCFC',      // oklch(0.985 0 0)
      primary: '#EBEBEB',         // oklch(0.922 0 0)
      primaryForeground: '#343434', // oklch(0.205 0 0)
      secondary: '#454545',       // oklch(0.269 0 0)
      secondaryForeground: '#FCFCFC', // oklch(0.985 0 0)
      muted: '#454545',          // oklch(0.269 0 0)
      mutedForeground: '#B5B5B5', // oklch(0.708 0 0)
      accent: '#454545',         // oklch(0.269 0 0)
      accentForeground: '#FCFCFC', // oklch(0.985 0 0)
      destructive: '#E74C3C',     // oklch(0.704 0.191 22.216) - approximate
    }

    it('should have sufficient contrast for primary text on background', () => {
      const ratio = getContrastRatio(
        darkModeColors.foreground,
        darkModeColors.background
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for primary button text', () => {
      const ratio = getContrastRatio(
        darkModeColors.primaryForeground,
        darkModeColors.primary
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for secondary button text', () => {
      const ratio = getContrastRatio(
        darkModeColors.secondaryForeground,
        darkModeColors.secondary
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for muted text', () => {
      const ratio = getContrastRatio(
        darkModeColors.mutedForeground,
        darkModeColors.background
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for destructive button text', () => {
      const ratio = getContrastRatio(
        '#FFFFFF',
        darkModeColors.destructive
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for accent text', () => {
      const ratio = getContrastRatio(
        darkModeColors.accentForeground,
        darkModeColors.accent
      )
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('Alert Component Color Combinations', () => {
    it('should have sufficient contrast for success alert', () => {
      // Success alert: green text on green background
      const textColor = '#166534' // dark green
      const bgColor = '#F0FDF4'   // light green
      const ratio = getContrastRatio(textColor, bgColor)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for error alert', () => {
      // Error alert: white text on red background
      const textColor = '#FFFFFF'
      const bgColor = '#E74C3C'
      const ratio = getContrastRatio(textColor, bgColor)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for warning alert', () => {
      // Warning alert: yellow text on yellow background
      const textColor = '#854D0E' // dark yellow
      const bgColor = '#FEFCE8'   // light yellow
      const ratio = getContrastRatio(textColor, bgColor)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it('should have sufficient contrast for info alert', () => {
      // Info alert: blue text on blue background
      const textColor = '#1E40AF' // dark blue
      const bgColor = '#EFF6FF'   // light blue
      const ratio = getContrastRatio(textColor, bgColor)
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })
  })

  describe('Large Text (18pt+ or 14pt+ bold)', () => {
    // Large text only requires 3:1 contrast ratio for WCAG AA
    it('should have sufficient contrast for large text (lower threshold)', () => {
      // Example: large heading text
      const textColor = '#666666'
      const bgColor = '#FFFFFF'
      const ratio = getContrastRatio(textColor, bgColor)
      // Large text requires minimum 3:1
      expect(ratio).toBeGreaterThanOrEqual(3.0)
    })
  })

  describe('Interactive Element States', () => {
    it('should have sufficient contrast for focus ring', () => {
      const ringColor = '#B5B5B5'  // oklch(0.708 0 0)
      const bgColor = '#FFFFFF'
      const ratio = getContrastRatio(ringColor, bgColor)
      // Focus indicators should be visible (3:1 minimum)
      expect(ratio).toBeGreaterThanOrEqual(3.0)
    })

    it('should have sufficient contrast for border on background', () => {
      const borderColor = '#EBEBEB'
      const bgColor = '#FFFFFF'
      const ratio = getContrastRatio(borderColor, bgColor)
      // Borders should be visible (3:1 minimum for non-text)
      expect(ratio).toBeGreaterThanOrEqual(3.0)
    })
  })
})
