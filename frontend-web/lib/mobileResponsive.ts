/**
 * Mobile Responsive Guidelines for Minispace Admin
 * 
 * Touch target sizes: minimum 44x44px (WCAG 2.5)
 * Spacing: minimum 8px between interactive elements
 * Font sizes on mobile: minimum 14px (16px recommended to avoid zoom)
 */

export const MOBILE_RESPONSIVE = {
  // Touch targets
  touchTarget: {
    minWidth: "44px",
    minHeight: "44px",
    padding: "10px 12px", // py-2.5 px-3 in Tailwind
  },

  // Common Tailwind classes for responsive components
  buttonTouchSafe: "px-3 py-2.5 md:py-2", // Extra vertical padding on mobile
  inputTouchSafe: "px-3 py-2.5 md:py-2", // 44px height on mobile
  selectTouchSafe: "px-3 py-2.5 md:py-2 text-base md:text-sm", // 16px font on mobile prevents zoom

  // Mobile-first dropdown/modal positioning
  mobileDropdown: {
    desktop: "absolute top-full left-0 mt-1", // For desktop
    mobile: "fixed inset-0", // Bottom sheet fills screen
  },

  // Spacing between elements
  spacing: {
    touchGap: "gap-2", // 8px minimum gap between touch targets
  },

  // Form inputs
  formInput: "px-3 py-2.5 md:py-2 text-base md:text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500",
  formLabel: "block text-sm md:text-xs font-medium text-slate-500 mb-2 md:mb-1",

  // Mobile-safe modals
  modal: {
    overlay: "fixed inset-0 bg-black/30 z-40",
    contentDesktop: "absolute", // positioned via transform/translate
    contentMobile: "fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl", // bottom sheet
  },
};

// Check if viewport is mobile
export const isMobileViewport = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768; // md breakpoint
};

export default MOBILE_RESPONSIVE;
