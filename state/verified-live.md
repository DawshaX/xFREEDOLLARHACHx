# التحقق الحي — الأدوات والسلسلة الكاملة على أهداف مسموح بها

> اتولّد من `scripts/verify-live.mjs` (شغّله `.github/workflows/live-verify.yml`).
> كل هدف هنا صاحبه منشور صراحة إن فحصه مسموح — الوثيقة في العمود الأخير.

آخر تشغيل: `2026-11-12T19:02:57.309Z` · الحكم: **GREEN** · ✓21 · ✗0 · ؟0 · (محجوب)0
الأدوات المرصودة: dnsx, subfinder, httpx, nuclei, katana, nmap, naabu, ffuf · المحرك: `http://127.0.0.1:8090/api` · هدف التمرين: `scanme.nmap.org`

| الطبقة | الفحص | الحالة | التفصيل |
|---|---|---|---|
| cli | dns resolution | ✓ pass | 2600:3c01::f03c:91ff:fe18:bb2f scanme.nmap.org · dnsx=present |
| cli | subfinder -d vulnweb.com | ✓ pass | 19 سوبدومين (المطلوب ≥2) · www.test.php.vulnweb.com, www.vulnweb.com, odincovo.vulnweb.com |
| cli | httpx https://demo.testfire.net/ | ✓ pass | 200 · Altoro Mutual · |
| cli | katana crawl testphp.vulnweb.com | ✓ pass | 1 رابط متكرول (المطلوب ≥1) |
| cli | nuclei -u testphp.vulnweb.com (high,critical) | ✓ pass | 4 طلب اتفحص و0 نتيجة high/critical · exit=0 · قوالب: [[34mINF[0m] No new updates found for nuclei templates |
| cli | nmap scanme.nmap.org:80,22 | ✓ pass | 2 بورت مفتوح · 22/tcp open · 80/tcp open |
| cli | hub nova.waifly.com | ✓ pass | https://nova.waifly.com/api/health → HTTP 200 · JSON 93B · ops bundle ✓ · 735ms |
| cli | ffuf fuzz testphp.vulnweb.com | ✓ pass | 61 طلب مُرسل و0 مطابقة (1 سطر مخرجات) |
| engine | engine reachable | ✓ pass | HTTP 200 |
| engine | kinds report tool presence | ✓ pass | 27 نوع شغال على النود: recon.dns, recon.tls, recon.headers, recon.ports, recon.certspotter, infra.freehosts, recon.securitytxt, recon.jspaths, intel.cvebytech, intel.advisories, intel.corpus, tools.nuclei, tools.httpx, tools.subfinder, tools.katana, tools.nmap, tools.amass, tools.naabu, tools.ffuf,… |
| engine | bounty catalog served | ✓ pass | 746 برنامج (511 بمكافأة) · آخر تحديث 10.1 يوم · ops/bounty/programs-catalog.json |
| engine | catalog lookup over HTTP | ✓ pass | aces-dev.wnba.com → hackerone:nba-public (domain · استقبال open) · ونطاق مجهول → match:null |
| engine | program registered active (demo.testfire.net) | ✓ pass | id=demo.testfire.net · policy=https://demo.testfire.net/ |
| engine | job created | ✓ pass | job=20261112-1731c9 · 7 مهمة |
| engine | job executed | ✓ pass | 7/7 done · 0 failed · 11 finding · done |
| engine | evidence hashed on disk | ✓ pass | 6 ملف في state/jobs/20261112-1731c9/evidence · 6 فيهم بايتات |
| engine | report is honest about coverage | ✓ pass | 614 بايت · فيه «Coverage gaps»=true · «reportable»=true |
| engine | findings vault is idempotent | ✓ pass | أول sync: +28/-28 (من مهام 21 · من الكتالوج القديم 11) · تاني: +0/-28 ومحدّثة 32 · متأكَّدة 0 |
| engine | report draft gated on reproduction | ✓ pass | 3 مفتاح: 0 مسودة (200) · 3 مرفوضة (409) · البنية=true · سبب الرفض موجود=true |
| engine | hunt candidates stay context-only | ✓ pass | 12 مرشّح من 746 برنامج · أعلى استجابة 100% · مفلوت {"notBounty":235,"pausedOrClosed":0,"lowEfficiency":376,"platform":0,"query":0} · CIDR سياق بس=true · ترتيب=true |
| engine | negative control refuses example.com | ✓ pass | HTTP 403 · برنامج Negative control (must never be scanned actively) محدد passive_only — استطلاع ومصادر عامة بس، من غير لمس الخدمة. للتفعيل لازم تأكيد إذن مكتوب: program_d… |

## الإذن لكل هدف (مش كرم — وثيقة)

- `scanme.nmap.org` — مضيف مخصص لاختبار nmap — صاحبه (Gordon Lyon) كاتب صراحة إن المسح مسموح · [السياسة](https://scanme.nmap.org/)
- `testphp.vulnweb.com` — موقع اختبار Acunetix — منشور للاستخدام مع الماسحات (nuclei/zap/burp) في وثائقهم · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- `demo.testfire.net` — تطبيق اختبار IBM العام (AppScan) — مبني عشان يتفحص · [السياسة](https://demo.testfire.net/)
- `vulnweb.com` — نطاق اختبار عام لتعداد النطاقات الفرعية (مصادر DNS/شهادات — بيلمس سجلات مش خدمة) · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- **سيطرة سلبية**: أي فحص نشط على `example.com` لازم **يترفض**. لو السطر ده بقى ✗ فده مكسور في البوابة، مش في الأدوات.

_«blocked» = الشبكة/الهدف ماردّوش — مش إثبات إن الأداة بايظة. «review» = الأداة اشتغلت بس التوقع ما اتحققش النهارده (موقع إصلاح ثغراته أو تغيير سياسة)._
