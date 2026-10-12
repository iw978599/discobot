// Amazon Kindle and Fire devices are given the phone layout. The layout is chosen by the page's
// width alone, so a Kindle is made to report a narrow one: ui/index.html sets the viewport width
// for these devices before anything is drawn, using the same expression as this one (a test
// checks they match). Forms recognised, from Amazon's Silk developer guide: every Silk user
// agent contains "Silk/" (tablet, mobile and desktop view, where the Android and model tokens
// are absent), Fire tablets name a model beginning "KF" (KFTT, KFAUWI, KFMAWI), and the
// e-reader browser contains "Kindle/".
export const KINDLE_PATTERN = /\bSilk\/|\bKindle\b|\bKF[A-Z]{2,6}\b/;

// The layout width a Kindle is given. Under the 720px the phone layout starts at, so an upright
// or sideways Fire (a 16:10 screen) always counts as a phone, and over the 600 CSS pixels of
// the narrowest Fire so that the page is never shrunk by much.
export const KINDLE_VIEWPORT_WIDTH = 640;

export function isKindle(userAgent: string): boolean {
  return KINDLE_PATTERN.test(userAgent);
}
