/* ⛔ نسخة ظلّ ميتة (dead shadow): الملف ده محطوط في src/lib/lib/ ومفيش أي ملف في
   المشروع بيستورده — النسخة الحقيقية اللي بتشتغل هي "../logger.ts".
   أي تعديل هنا ما بيوصلش للسيرفر أبداً (اتلمس بالفحص: 0 مستوردين). الملف متسابش
   بالمحتوى بتاعه عشان مفيش حاجة تتلغي، بس الفاحص بيمنع استيراده. */
import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
