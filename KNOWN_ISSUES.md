# Known Issues

This document tracks known issues found during testing that need to be addressed.

## Critical Issues

None currently.

## High Priority Issues

### Frontend Color Contrast Accessibility Issues

**Status**: Open  
**Priority**: High  
**Component**: Frontend UI  
**Property**: Property 44 - Color contrast compliance

**Description**:
Several color combinations in the frontend do not meet WCAG AA accessibility standards for color contrast:

1. **Muted text** (Light mode): Contrast ratio 3.28:1 (requires 4.5:1)
2. **Destructive button text** (Light & Dark mode): Contrast ratio 3.82:1 (requires 4.5:1)
3. **Error alert text**: Contrast ratio 3.82:1 (requires 4.5:1)
4. **Focus ring**: Contrast ratio 2.05:1 (requires 3.0:1)
5. **Border on background**: Contrast ratio 1.19:1 (requires 3.0:1)

**Impact**:
- Users with visual impairments may have difficulty reading text
- Fails WCAG AA accessibility standards
- May cause legal compliance issues

**Recommendation**:
Adjust the following colors in the design system:

```css
/* Current problematic colors */
--muted: hsl(210 40% 96.1%);           /* Too light */
--destructive: #E74C3C;                 /* Insufficient contrast with white */
--ring: hsl(222.2 84% 4.9%);           /* Too similar to background */
--border: hsl(214.3 31.8% 91.4%);      /* Too light */

/* Suggested fixes */
--muted: hsl(210 40% 85%);             /* Darker for better contrast */
--destructive: #C0392B;                 /* Darker red */
--ring: hsl(222.2 84% 20%);            /* More visible */
--border: hsl(214.3 31.8% 75%);        /* Darker border */
```

**Test Results**:
```
✗ should have sufficient contrast for muted text (3.28:1 < 4.5:1)
✗ should have sufficient contrast for destructive button text (3.82:1 < 4.5:1)
✗ should have sufficient contrast for error alert (3.82:1 < 4.5:1)
✗ should have sufficient contrast for focus ring (2.05:1 < 3.0:1)
✗ should have sufficient contrast for border on background (1.19:1 < 3.0:1)
```

**Files to Update**:
- `frontend/src/app/globals.css` - Update CSS custom properties
- `frontend/src/test/color-contrast.test.ts` - Verify fixes

**Assigned to**: TBD  
**Target date**: Before production deployment

---

## Medium Priority Issues

### Google OAuth Not Fully Configured

**Status**: Open  
**Priority**: Medium  
**Component**: Backend Authentication

**Description**:
Google OAuth integration is implemented but requires manual configuration:
- Google Cloud project needs to be created
- OAuth consent screen needs to be configured
- Client ID and Client Secret need to be added to configuration

**Impact**:
- Users cannot authenticate with Google until configured
- Feature is non-functional in current state

**Recommendation**:
Follow the setup guide in `GOOGLE_OAUTH_SETUP.md` to complete configuration.

**Assigned to**: TBD  
**Target date**: Before enabling Google OAuth feature

---

### Database Connection String in appsettings.json

**Status**: Open  
**Priority**: Medium  
**Component**: Backend Configuration  
**Security**: Yes

**Description**:
The default connection string in `appsettings.json` uses localhost with default credentials. This is fine for development but should not be used in production.

**Impact**:
- Security risk if deployed to production without changing
- Not using Supabase connection string by default

**Recommendation**:
1. Update `appsettings.json` to use environment variable placeholders
2. Document required environment variables
3. Use User Secrets for local development
4. Use Azure Key Vault or similar for production

**Files to Update**:
- `src/PitchMate.API/appsettings.json`
- `src/PitchMate.API/appsettings.Production.json` (create)

**Assigned to**: TBD  
**Target date**: Before production deployment

---

## Low Priority Issues

### JWT Secret Key in appsettings.json

**Status**: Open  
**Priority**: Low (Development only)  
**Component**: Backend Authentication  
**Security**: Yes

**Description**:
The JWT secret key is hardcoded in `appsettings.json` with a development-only warning. This is acceptable for development but must be changed for production.

**Impact**:
- Security risk if deployed to production without changing
- Tokens could be forged if secret is compromised

**Recommendation**:
1. Generate a strong random secret for production
2. Store in environment variable or Azure Key Vault
3. Never commit production secrets to source control

**Assigned to**: TBD  
**Target date**: Before production deployment

---

### No Rate Limiting on Authentication Endpoints

**Status**: Open  
**Priority**: Low  
**Component**: Backend API

**Description**:
Authentication endpoints (`/api/auth/register`, `/api/auth/login`, `/api/auth/google`) do not have rate limiting implemented.

**Impact**:
- Vulnerable to brute force attacks
- Vulnerable to credential stuffing
- Could be used for DoS attacks

**Recommendation**:
Implement rate limiting using ASP.NET Core middleware:
- Limit registration attempts per IP
- Limit login attempts per email/IP
- Implement exponential backoff for failed attempts

**Assigned to**: TBD  
**Target date**: Before production deployment

---

### No Logging/Monitoring Configured

**Status**: Open  
**Priority**: Low  
**Component**: Backend API

**Description**:
Application logging is configured but no external logging/monitoring service is integrated (e.g., Application Insights, Serilog, etc.).

**Impact**:
- Difficult to diagnose production issues
- No visibility into application health
- No alerting for errors

**Recommendation**:
1. Integrate with Application Insights or similar
2. Configure structured logging with Serilog
3. Set up alerts for critical errors
4. Implement health check endpoints

**Assigned to**: TBD  
**Target date**: Before production deployment

---

### Frontend Environment Variables Not Documented

**Status**: Open  
**Priority**: Low  
**Component**: Frontend

**Description**:
The frontend requires environment variables but they're not clearly documented in the main README.

**Impact**:
- New developers may not know what to configure
- Deployment may fail due to missing variables

**Recommendation**:
1. Update README.md with required environment variables
2. Provide example .env.local file (already created: `.env.local.example`)
3. Document what each variable does

**Assigned to**: TBD  
**Target date**: Before onboarding new developers

---

## Resolved Issues

None yet.

---

## Issue Tracking

To report a new issue:
1. Add it to this document under the appropriate priority section
2. Include: Status, Priority, Component, Description, Impact, Recommendation
3. Assign to a team member if known
4. Set a target date

To resolve an issue:
1. Fix the issue
2. Move it to the "Resolved Issues" section
3. Add resolution date and notes
4. Update related documentation

---

## Test Results Summary

### Backend Tests
- ✅ Domain Layer: 166/166 tests passing
- ✅ Application Layer: 33/33 tests passing
- ✅ Infrastructure Layer: 35/35 tests passing
- ✅ API Layer: 37/37 tests passing
- **Total: 271/271 tests passing (100%)**

### Frontend Tests
- ✅ Responsive Breakpoints: 30/30 tests passing
- ❌ Color Contrast: 13/19 tests passing (6 failures)
- **Total: 43/49 tests passing (87.8%)**

### Property-Based Tests
- ✅ All 43 property-based tests passing with 100+ iterations

### Overall Test Status
- **Backend: 100% passing** ✅
- **Frontend: 87.8% passing** ⚠️ (accessibility issues)
- **Property Tests: 100% passing** ✅

---

Last Updated: January 15, 2026
