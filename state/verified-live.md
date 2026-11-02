# التحقق الحي — الأدوات والسلسلة الكاملة على أهداف مسموح بها

> اتولّد من `scripts/verify-live.mjs` (شغّله `.github/workflows/live-verify.yml`).
> كل هدف هنا صاحبه منشور صراحة إن فحصه مسموح — الوثيقة في العمود الأخير.

آخر تشغيل: `2026-11-02T13:19:25.290Z` · الحكم: **AMBER** · ✓11 · ✗0 · ؟5 · (محجوب)0
الأدوات المرصودة: dnsx, subfinder, httpx, nuclei, katana, nmap, naabu · المحرك: `http://127.0.0.1:8090/api` · هدف التمرين: `scanme.nmap.org`

| الطبقة | الفحص | الحالة | التفصيل |
|---|---|---|---|
| cli | dns resolution | ✓ pass | 2600:3c01::f03c:91ff:fe18:bb2f scanme.nmap.org · dnsx=present |
| cli | subfinder -d vulnweb.com | ✓ pass | 518 سوبدومين (المطلوب ≥2) · viruswall.vulnweb.com, charmglm.vulnweb.com, 2207.vulnweb.com |
| cli | httpx https://scanme.nmap.org/ | ? review | exit 0 |
| cli | katana crawl testphp.vulnweb.com | ? review | 0 رابط متكرول (المطلوب ≥5) |
| cli | nuclei -u testphp.vulnweb.com | ? review | مفيش نتيجة · exit 0 · |
| cli | nmap scanme.nmap.org:80,22 | ✓ pass | 2 بورت مفتوح · 22/tcp open · 80/tcp open |
| cli | ffuf present | ? review | مش موجود — مش حرجي |
| engine | engine reachable | ✓ pass | HTTP 200 |
| engine | kinds report tool presence | ✓ pass | 14 نوع شغال على النود: recon.dns, recon.tls, recon.headers, recon.ports, recon.certspotter, infra.freehosts, recon.securitytxt, recon.jspaths, intel.cvebytech, tools.nuclei, tools.httpx, tools.subfinder, tools.katana, tools.nmap |
| engine | program registered active (scanme.nmap.org) | ✓ pass | id=scanme.nmap.org · policy=https://scanme.nmap.org/ |
| engine | job created | ✓ pass | job=20261102-6f71c7 · 7 مهمة |
| engine | job executed | ✓ pass | 2/7 done · 5 failed · 4 finding · done |
| engine | failed tasks | ? review | recon.headers: probe-unreachable · recon.tls: tls-unreachable · tools.subfinder: tool-missing · tools.httpx: tool-missing · tools.nuclei: tool-missing |
| engine | evidence hashed on disk | ✓ pass | 2 ملف في state/jobs/20261102-6f71c7/evidence · 2 فيهم بايتات |
| engine | report is honest about coverage | ✓ pass | 804 بايت · فيه «Coverage gaps»=true · «reportable»=true |
| engine | negative control refuses example.com | ✓ pass | HTTP 403 · برنامج Negative control (must never be scanned actively) محدد passive_only — استطلاع ومصادر عامة بس، من غير لمس الخدمة. للتفعيل لازم تأكيد إذن مكتوب: program_d… |

## الإذن لكل هدف (مش كرم — وثيقة)

- `scanme.nmap.org` — مضيف مخصص لاختبار nmap — صاحبه (Gordon Lyon) كاتب صراحة إن المسح مسموح · [السياسة](https://scanme.nmap.org/)
- `testphp.vulnweb.com` — موقع اختبار Acunetix — منشور للاستخدام مع الماسحات (nuclei/zap/burp) في وثائقهم · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- `demo.testfire.net` — تطبيق اختبار IBM العام (AppScan) — مبني عشان يتفحص · [السياسة](https://demo.testfire.net/)
- `vulnweb.com` — نطاق اختبار عام لتعداد النطاقات الفرعية (مصادر DNS/شهادات — بيلمس سجلات مش خدمة) · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- **سيطرة سلبية**: أي فحص نشط على `example.com` لازم **يترفض**. لو السطر ده بقى ✗ فده مكسور في البوابة، مش في الأدوات.

_«blocked» = الشبكة/الهدف ماردّوش — مش إثبات إن الأداة بايظة. «review» = الأداة اشتغلت بس التوقع ما اتحققش النهارده (موقع إصلاح ثغراته أو تغيير سياسة)._
