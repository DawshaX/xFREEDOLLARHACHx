# التحقق الحي — الأدوات والسلسلة الكاملة على أهداف مسموح بها

> اتولّد من `scripts/verify-live.mjs` (شغّله `.github/workflows/live-verify.yml`).
> كل هدف هنا صاحبه منشور صراحة إن فحصه مسموح — الوثيقة في العمود الأخير.

آخر تشغيل: `2026-11-03T01:18:37.833Z` · الحكم: **AMBER** · ✓15 · ✗0 · ؟1 · (محجوب)1
الأدوات المرصودة: dnsx, subfinder, httpx, nuclei, katana, nmap, naabu, ffuf · المحرك: `http://127.0.0.1:8090/api` · هدف التمرين: `scanme.nmap.org`

| الطبقة | الفحص | الحالة | التفصيل |
|---|---|---|---|
| cli | dns resolution | ✓ pass | 2600:3c01::f03c:91ff:fe18:bb2f scanme.nmap.org · dnsx=present |
| cli | subfinder -d vulnweb.com | ✓ pass | 518 سوبدومين (المطلوب ≥2) · 08d.vulnweb.com, nicolas7.vulnweb.com, 0-il8.vulnweb.com |
| cli | httpx https://demo.testfire.net/ | ✓ pass | 200 · Altoro Mutual · |
| cli | katana crawl testphp.vulnweb.com | ✓ pass | 1 رابط متكرول (المطلوب ≥1) |
| cli | nuclei -u testphp.vulnweb.com (high,critical) | ✓ pass | 4 طلب اتفحص و0 نتيجة high/critical · exit=0 · قوالب: [[34mINF[0m] No new updates found for nuclei templates |
| cli | nmap scanme.nmap.org:80,22 | ✓ pass | 2 بورت مفتوح · 22/tcp open · 80/tcp open |
| cli | hub node.waifly.com:27214 | · blocked | http://node.waifly.com:27214/api/health → HTTP 000 · بلا رد · ops/version بلا رد · 428ms · السبب: TypeError fetch failed ECONNREFUSED — الـconnection refused معناه مافيش حاجة بتتسمع على البورت (مش فايروال بيسقّط): شغّل العملية أو اربط البو… |
| cli | ffuf fuzz testphp.vulnweb.com | ✓ pass | 61 طلب مُرسل و0 مطابقة (1 سطر مخرجات) |
| engine | engine reachable | ✓ pass | HTTP 200 |
| engine | kinds report tool presence | ✓ pass | 14 نوع شغال على النود: recon.dns, recon.tls, recon.headers, recon.ports, recon.certspotter, infra.freehosts, recon.securitytxt, recon.jspaths, intel.cvebytech, tools.nuclei, tools.httpx, tools.subfinder, tools.katana, tools.nmap |
| engine | program registered active (demo.testfire.net) | ✓ pass | id=demo.testfire.net · policy=https://demo.testfire.net/ |
| engine | job created | ✓ pass | job=20261103-e89c08 · 7 مهمة |
| engine | job executed | ✓ pass | 6/7 done · 1 failed · 11 finding · done |
| engine | failed tasks | ? review | tools.nuclei: nuclei اتقطع بعد 260019ms (ميزانية النوع) · 0 نتيجة لحد هنا — «اتقطع» مش «مافيش» |
| engine | evidence hashed on disk | ✓ pass | 6 ملف في state/jobs/20261103-e89c08/evidence · 6 فيهم بايتات |
| engine | report is honest about coverage | ✓ pass | 622 بايت · فيه «Coverage gaps»=true · «reportable»=true |
| engine | negative control refuses example.com | ✓ pass | HTTP 403 · برنامج Negative control (must never be scanned actively) محدد passive_only — استطلاع ومصادر عامة بس، من غير لمس الخدمة. للتفعيل لازم تأكيد إذن مكتوب: program_d… |

## الإذن لكل هدف (مش كرم — وثيقة)

- `scanme.nmap.org` — مضيف مخصص لاختبار nmap — صاحبه (Gordon Lyon) كاتب صراحة إن المسح مسموح · [السياسة](https://scanme.nmap.org/)
- `testphp.vulnweb.com` — موقع اختبار Acunetix — منشور للاستخدام مع الماسحات (nuclei/zap/burp) في وثائقهم · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- `demo.testfire.net` — تطبيق اختبار IBM العام (AppScan) — مبني عشان يتفحص · [السياسة](https://demo.testfire.net/)
- `vulnweb.com` — نطاق اختبار عام لتعداد النطاقات الفرعية (مصادر DNS/شهادات — بيلمس سجلات مش خدمة) · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- **سيطرة سلبية**: أي فحص نشط على `example.com` لازم **يترفض**. لو السطر ده بقى ✗ فده مكسور في البوابة، مش في الأدوات.

_«blocked» = الشبكة/الهدف ماردّوش — مش إثبات إن الأداة بايظة. «review» = الأداة اشتغلت بس التوقع ما اتحققش النهارده (موقع إصلاح ثغراته أو تغيير سياسة)._
