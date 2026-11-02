# `nova-runs/` — تقارير الطابور اللي بيشغّله جيت-هَب

المجلد ده **بيُكتب آلياً**: `scripts/nova-queue-runner.mjs` (شغّال جوه
`.github/workflows/nova-runner.yml`) بيحط فيه لكل بعثة:

- `<id>.md` — التقرير اللي كتبه المحرك نفسه (نفس ملف `GET /api/ops/jobs/<job>/report`)
- `<id>.json` — نفس البيانات لكن للآلة: مهام، عدادات، ملاحظات، مسارات الأدلة
- `index.json` — آخر 40 بعثة، للواجهة أو لأي حد عايز يقرأ من غير ما يفتح الريبو

الرابط العام: `https://dawshax.github.io/xFREEDOLLARHACHx/nova-runs/index.json`

## لو `runs: []` مع إن في بعثة اتنفّذت

يبقى النشر ماحدّثش. مافيش هنا تشخيص مخترع — فيه أمر بيريح الجواب:

```bash
gh run list -R DawshaX/xFREEDOLLARHACHx --workflow "🌐 نشر المنصة على GitHub Pages (تحديث لحظي تلقائي)" -L 2
# لو آخر deploy أسبق من آخر commit على main:
gh workflow run deploy-pages.yml -R DawshaX/xFREEDOLLARHACHx -r main     # أو زرار Run workflow من Actions
```

اللي اتقاس النهارده (2026-11-02): `5525eed` (commit الروبوت) كان فيه علامة تخطي CI → ولا
workflow اتشغّل عليه، وشِلناها. بس `4866fce` و`59610be` مافيهومش العلامة دي والنشر برضه ماجاش —
يعني السبب الكامل مش متحقق منه، واللي بنقدّمه هو القياس فوق. وكل cron جاي (`nova-runner` كل
15 دقيقة، `free-host-survey` الساعة 12:15) بيعمل commit على main، فبيجرّر النشر وراه.
