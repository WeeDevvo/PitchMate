# Match Pages Responsive Testing Checklist

This document provides a comprehensive checklist for testing the responsive behavior of the match management pages across different devices and screen sizes.

## Test Environment Setup

### Devices to Test
- **Mobile**: 375px width (iPhone SE)
- **Tablet**: 768px width (iPad)
- **Desktop**: 1280px width (Standard laptop)
- **Large Desktop**: 1920px width (Full HD monitor)

### Browsers to Test
- Chrome/Edge (Chromium)
- Firefox
- Safari (iOS/macOS)

## Page 1: Matches List Page (`/squads/[id]/matches`)

### Layout Tests

#### Mobile (375px)
- [ ] Header displays correctly with back link
- [ ] Page title and match count are readable
- [ ] "Create Match" button (admin only) is full-width and accessible
- [ ] Upcoming matches section displays as single column
- [ ] Completed matches section displays as single column
- [ ] Match cards are properly sized and readable
- [ ] Match card content (date, time, players, team size) is visible
- [ ] Cards are tappable with adequate touch target size (min 44x44px)
- [ ] Empty state messages display correctly
- [ ] Navigation back link is easily tappable

#### Tablet (768px)
- [ ] Header layout adjusts appropriately
- [ ] "Create Match" button displays inline with header
- [ ] Match cards display in 2-column grid
- [ ] Card spacing is appropriate
- [ ] All text remains readable

#### Desktop (1280px+)
- [ ] Match cards display in 3-column grid
- [ ] Layout utilizes available space effectively
- [ ] Hover states work on match cards
- [ ] All interactive elements have visible hover states

### Functionality Tests

#### All Screen Sizes
- [ ] Clicking a match card navigates to match detail page
- [ ] "Create Match" button (admin) navigates to create page
- [ ] Back link navigates to squad detail page
- [ ] Error messages display correctly
- [ ] Loading states display correctly
- [ ] Empty states display correctly for both sections

### Content Tests

#### All Screen Sizes
- [ ] Match dates format correctly
- [ ] Match times format correctly
- [ ] Player counts display accurately
- [ ] Team sizes display accurately
- [ ] Status badges display correctly (Pending/Completed)
- [ ] Team ratings display when teams are generated
- [ ] Match result displays for completed matches

---

## Page 2: Match Creation Page (`/squads/[id]/matches/create`)

### Layout Tests

#### Mobile (375px)
- [ ] Header displays correctly with back link
- [ ] Page title and description are readable
- [ ] Form sections stack vertically
- [ ] Date and time inputs stack vertically
- [ ] Team size input is full-width
- [ ] "Select All" and "Clear All" buttons stack or wrap appropriately
- [ ] Player selection grid displays as single column
- [ ] Player cards are properly sized with adequate touch targets
- [ ] Selected player count badge is visible
- [ ] Submit and Cancel buttons are full-width and stack vertically
- [ ] Form validation messages display correctly

#### Tablet (768px)
- [ ] Date and time inputs display side-by-side
- [ ] Player selection grid displays in 2 columns
- [ ] Action buttons display inline
- [ ] Form maintains good spacing

#### Desktop (1280px+)
- [ ] Player selection grid displays in 3 columns
- [ ] Form sections use available space effectively
- [ ] All form controls are appropriately sized
- [ ] Submit/Cancel buttons align to the right

### Functionality Tests

#### All Screen Sizes
- [ ] Date picker works correctly
- [ ] Time picker works correctly
- [ ] Team size input accepts valid numbers
- [ ] Player selection toggles work (tap/click)
- [ ] "Select All" button selects all players
- [ ] "Clear All" button deselects all players
- [ ] Selected player count updates in real-time
- [ ] Badge shows error state for odd number of players
- [ ] Form validation prevents submission with invalid data
- [ ] Form validation messages are clear and visible
- [ ] Submit button is disabled when form is invalid
- [ ] Cancel button navigates back to matches list
- [ ] Success navigation works after match creation

### Content Tests

#### All Screen Sizes
- [ ] Default date is set to today
- [ ] Default time is set to 18:00
- [ ] Default team size is 5
- [ ] Player cards show user ID (truncated)
- [ ] Player cards show current rating
- [ ] Admin badge displays for admin players
- [ ] "You" label displays for current user
- [ ] Selected state is visually clear (checkmark icon)
- [ ] Player count validation message is clear
- [ ] Error messages are descriptive

---

## Page 3: Match Detail Page (`/squads/[id]/matches/[matchId]`)

### Layout Tests

#### Mobile (375px)
- [ ] Header displays correctly with back link
- [ ] Match title, status badge, and date/time are readable
- [ ] "Record Result" button (admin, pending matches) is full-width
- [ ] Match result card displays correctly (completed matches)
- [ ] Team cards stack vertically
- [ ] Player lists within team cards are readable
- [ ] Match information card displays correctly
- [ ] All sections have appropriate spacing

#### Tablet (768px)
- [ ] "Record Result" button displays inline with header
- [ ] Team cards may start displaying side-by-side
- [ ] Content remains readable and well-spaced

#### Desktop (1280px+)
- [ ] Team cards display side-by-side in 2-column grid
- [ ] Layout utilizes available space effectively
- [ ] All cards are properly aligned

### Functionality Tests

#### All Screen Sizes
- [ ] Back link navigates to matches list
- [ ] "Record Result" dialog opens correctly (admin, pending)
- [ ] Winner selection dropdown works
- [ ] Balance feedback input works
- [ ] Dialog submit button is disabled when no winner selected
- [ ] Dialog cancel button closes dialog without submitting
- [ ] Dialog submit button records result and updates page
- [ ] Error messages display correctly
- [ ] Loading states display correctly

### Content Tests

#### All Screen Sizes
- [ ] Match date and time format correctly
- [ ] Status badge displays correctly
- [ ] Match result displays correctly (completed matches)
- [ ] Winner badge displays on correct team card
- [ ] Balance feedback displays when provided
- [ ] Team total ratings display correctly
- [ ] Player ratings display correctly
- [ ] Player user IDs display (truncated)
- [ ] Match information displays all details correctly
- [ ] Empty state displays when teams not generated

---

## Dialog/Modal Tests

### Record Result Dialog

#### All Screen Sizes
- [ ] Dialog is centered on screen
- [ ] Dialog is appropriately sized for screen
- [ ] Dialog content is readable
- [ ] Dialog doesn't overflow screen on mobile
- [ ] Dialog can be dismissed by clicking outside (if enabled)
- [ ] Dialog can be dismissed by cancel button
- [ ] Form controls within dialog work correctly
- [ ] Submit button behavior is correct

---

## Cross-Page Navigation Tests

### All Screen Sizes
- [ ] Navigation from squad detail → matches list works
- [ ] Navigation from matches list → match detail works
- [ ] Navigation from matches list → create match works (admin)
- [ ] Navigation from create match → matches list works (cancel)
- [ ] Navigation from create match → matches list works (success)
- [ ] Navigation from match detail → matches list works
- [ ] Back button behavior is consistent
- [ ] URL parameters are preserved correctly

---

## Accessibility Tests

### Keyboard Navigation
- [ ] All interactive elements are keyboard accessible
- [ ] Tab order is logical
- [ ] Focus indicators are visible
- [ ] Dialogs trap focus appropriately
- [ ] Escape key closes dialogs

### Touch Interactions
- [ ] All touch targets are minimum 44x44px
- [ ] Touch targets have adequate spacing
- [ ] No accidental activations
- [ ] Swipe gestures don't interfere with navigation

### Screen Readers
- [ ] Page titles are announced
- [ ] Form labels are associated correctly
- [ ] Error messages are announced
- [ ] Status changes are announced
- [ ] Buttons have descriptive labels

---

## Performance Tests

### All Screen Sizes
- [ ] Pages load quickly
- [ ] Images/icons load correctly
- [ ] No layout shift during load
- [ ] Smooth transitions and animations
- [ ] No janky scrolling

---

## Edge Cases

### Empty States
- [ ] No matches in squad displays correctly
- [ ] No members in squad displays correctly (create page)
- [ ] Teams not generated displays correctly (detail page)

### Error States
- [ ] API errors display user-friendly messages
- [ ] Network errors are handled gracefully
- [ ] Invalid match ID shows appropriate error
- [ ] Unauthorized access shows appropriate message

### Data Validation
- [ ] Odd number of players shows error
- [ ] Less than 2 players shows error
- [ ] Invalid team size shows error
- [ ] Missing date/time shows error
- [ ] Already completed match prevents result submission

---

## Testing Notes

### How to Test Responsive Behavior

1. **Browser DevTools**:
   - Open Chrome/Firefox DevTools (F12)
   - Toggle device toolbar (Ctrl+Shift+M)
   - Select different device presets
   - Test at custom widths: 375px, 768px, 1280px, 1920px

2. **Real Devices**:
   - Test on actual mobile devices when possible
   - Test on tablets
   - Test on different desktop screen sizes

3. **Orientation**:
   - Test both portrait and landscape on mobile/tablet
   - Verify layout adjusts appropriately

### Common Issues to Watch For

- Text overflow or truncation
- Buttons too small to tap on mobile
- Horizontal scrolling on mobile
- Overlapping elements
- Unreadable text sizes
- Poor contrast
- Missing hover states on desktop
- Broken layouts at breakpoint transitions

### Breakpoints Used

The application uses Tailwind CSS default breakpoints:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

---

## Sign-off

### Tester Information
- **Tester Name**: _______________
- **Date**: _______________
- **Environment**: _______________

### Test Results
- [ ] All mobile tests passed
- [ ] All tablet tests passed
- [ ] All desktop tests passed
- [ ] All functionality tests passed
- [ ] All accessibility tests passed

### Issues Found
(List any issues discovered during testing)

1. 
2. 
3. 

### Additional Notes
(Any additional observations or recommendations)

