/**
 * skull.ts — أصل الجمجمة السايبرية الحمراء (هوية DAWSHA).
 * يُستورد كأصل Vite مباشر لضمان ظهوره في جميع المسارات (/, sub-path, standalone)
 * دون أن ينكسر أو يتحول إلى دائرة فارغة أبداً، مع إبقاء public/daw-skull.jpg كنسخة مساعدة.
 */
import dawSkullAsset from "../assets/daw-skull.jpg";

export const DAW_SKULL: string = dawSkullAsset;
