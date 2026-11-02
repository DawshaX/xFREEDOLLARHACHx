# `nova-runs/` — تقارير الطابور اللي بيشغّله جيت-هَب

المجلد ده **بيُكتب آلياً**: `scripts/nova-queue-runner.mjs` (شغّال جوه
`.github/workflows/nova-runner.yml`) بيحط فيه لكل بعثة:

- `<id>.md` — التقرير اللي كتبه المحرك نفسه (نفس ملف `GET /api/ops/jobs/<job>/report`)
- `<id>.json` — نفس البيانات لكن للآلة: مهام، عدادات، ملاحظات، مسارات الأدلة
- `index.json` — آخر 40 بعثة، للواجهة أو لأي حد عايز يقرأ من غير ما يفتح الريبو

الرابط العام: `https://dawshax.github.io/xFREEDOLLARHACHx/nova-runs/index.json`

لو لقيت `runs: []` مع إن في بعثة اتنفذّت، يبقى الـpush بتاع الروبوت ما عملش
`deploy-pages` — الشرح في أول `.github/workflows/nova-runner.yml`.
