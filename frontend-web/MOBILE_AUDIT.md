# Mobile Responsiveness Audit Checklist - Minispace Admin

## Sprint 1 Completed

### ✅ Media Page (`/dashboard/media`)
- [x] Fixed child multi-select dropdown on mobile
- [x] Converted to bottom-sheet on mobile (item #2)
- [x] Proper z-index and overflow handling

### ✅ BottomSheet Component
- [x] Created reusable `BottomSheet.tsx` component
- [x] Handle bar for accessibility
- [x] Overlay with click-to-close
- [x] Body scroll prevention
- [x] Desktop hidden (md:hidden)

### ✅ Mobile Guidelines Created
- [x] `lib/mobileResponsive.ts` with WCAG 2.5 standards
- [x] Touch target sizes (44x44px minimum)
- [x] Spacing recommendations (8px between elements)
- [x] Font size guidelines (16px on mobile prevents zoom)

---

## Remaining Mobile Issues to Fix

### 1. Dashboard Navigation
**Location:** `components/layout/DashboardLayout.tsx`
**Status:** ⏳ To Review
- [ ] Verify hamburger menu on mobile
- [ ] Check nav item touch targets (should be ≥ 44px)
- [ ] Ensure drawer closes on navigation
- [ ] Test drawer on screens < 640px

### 2. Form Inputs Across Admin
**Locations:** All dashboard pages with forms
**Status:** ⏳ To Review
- [ ] Select inputs: use `selectTouchSafe` class
- [ ] Text inputs: use `inputTouchSafe` class
- [ ] Labels: ensure readable on mobile
- [ ] Error messages: not overlapping other elements

### 3. Tables/Grids on Mobile
**Locations:** children, media, documents, users pages
**Status:** ⏳ To Review
- [ ] Horizontal scroll handling
- [ ] Card-based view for mobile
- [ ] Touch-friendly action buttons
- [ ] No overlapping content

### 4. Action Menus (Edit, Delete, etc.)
**Locations:** All list pages
**Status:** ⏳ To Review
- [ ] Replace overflow menus with bottom-sheet on mobile
- [ ] Action buttons ≥ 44px
- [ ] Clear visual hierarchy

### 5. Modals/Dialogs
**Locations:** Create forms, confirmations, settings
**Status:** ⏳ To Review
- [ ] Use BottomSheet on mobile instead of centered modals
- [ ] Close button ≥ 44px
- [ ] Max-height with scroll for long forms

### 6. Search/Filter Inputs
**Locations:** Media, documents, children pages
**Status:** ⏳ To Review
- [ ] Input height ≥ 44px on mobile
- [ ] Clear button ≥ 44px and easily tappable
- [ ] No keyboard covering input value
- [ ] Debounce search for performance

---

## Testing Checklist for Mobile

### Device Testing
- [ ] iPhone SE (375px)
- [ ] iPhone 12/13 (390px)
- [ ] Android (360-412px)
- [ ] iPad (768px breakpoint)

### Touch Testing
- [ ] All buttons tappable without zoom
- [ ] No accidental taps on nearby elements
- [ ] Swipe gestures work if implemented
- [ ] Double-tap zoom disabled where needed

### Screen Coverage
- [ ] No content cut off
- [ ] Modals/sheets fit viewport
- [ ] Keyboard doesn't cover input
- [ ] Scroll bars visible when needed

### Performance
- [ ] Smooth scrolling
- [ ] No janky animations
- [ ] Fast response to taps

---

## Implementation Guide

Use these Tailwind patterns for consistency:

```typescript
// Touch-safe button
className="px-3 py-2.5 md:py-2"  // 44px height on mobile

// Touch-safe form input
className="px-3 py-2.5 md:py-2 text-base md:text-sm"

// Mobile-friendly select (use BottomSheet on mobile)
if (isMobileViewport()) {
  return <BottomSheet>{content}</BottomSheet>
} else {
  return <Dropdown>{content}</Dropdown>
}

// Mobile-safe spacing
className="gap-2"  // 8px minimum gap
```

---

## References

- WCAG 2.5.5 Target Size: https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
- Apple HIG Touch Targets: https://developer.apple.com/design/human-interface-guidelines/ios/visual-design/layout/
- Material Design Touch Targets: https://material.io/design/usability/accessibility.html
