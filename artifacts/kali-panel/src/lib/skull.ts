/**
 * skull.ts — أصل الجمجمة السايبرية الحمراء (هوية DAWSHA).
 * يُخدم من `public/daw-skull.jpg` (تجنب Data-URI فارغة) مع دعم BASE_URL
 * ليعمل في التطوير، والحزمة المحمولة، وGitHub Pages بدون انقطاع.
 */
const baseUrl =
  typeof import.meta !== "undefined" &&
  (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL
    ? (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL
    : "/";

export const DAW_SKULL = `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}daw-skull.jpg`;
