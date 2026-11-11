# التحقق الحي — الأدوات والسلسلة الكاملة على أهداف مسموح بها

> اتولّد من `scripts/verify-live.mjs` (شغّله `.github/workflows/live-verify.yml`).
> كل هدف هنا صاحبه منشور صراحة إن فحصه مسموح — الوثيقة في العمود الأخير.

آخر تشغيل: `2026-11-11T02:37:33.439Z` · الحكم: **RED** · ✓20 · ✗1 · ؟1 · (محجوب)0
الأدوات المرصودة: dnsx, subfinder, httpx, katana, nmap, naabu, ffuf · المحرك: `http://127.0.0.1:8090/api` · هدف التمرين: `scanme.nmap.org`

| الطبقة | الفحص | الحالة | التفصيل |
|---|---|---|---|
| cli | dns resolution | ✓ pass | 2600:3c01::f03c:91ff:fe18:bb2f scanme.nmap.org · dnsx=present |
| cli | subfinder -d vulnweb.com | ✓ pass | 518 سوبدومين (المطلوب ≥2) · 2v2.vulnweb.com, 2sylf.vulnweb.com, 07f7.vulnweb.com |
| cli | httpx https://demo.testfire.net/ | ✓ pass | 200 · Altoro Mutual · |
| cli | katana crawl testphp.vulnweb.com | ✓ pass | 1 رابط متكرول (المطلوب ≥1) |
| cli | nuclei present | ✗ fail | مش موجود — الـvendor فشل؟ |
| cli | nmap scanme.nmap.org:80,22 | ✓ pass | 2 بورت مفتوح · 22/tcp open · 80/tcp open |
| cli | hub nova.waifly.com | ✓ pass | https://nova.waifly.com/api/health → HTTP 200 · JSON 93B · ops bundle ✓ · 603ms |
| cli | ffuf fuzz testphp.vulnweb.com | ✓ pass | 61 طلب مُرسل و0 مطابقة (1 سطر مخرجات) |
| engine | engine reachable | ✓ pass | HTTP 200 |
| engine | kinds report tool presence | ✓ pass | 22 نوع شغال على النود: recon.dns, recon.tls, recon.headers, recon.ports, recon.certspotter, infra.freehosts, recon.securitytxt, recon.jspaths, intel.cvebytech, intel.advisories, intel.corpus, tools.httpx, tools.subfinder, tools.katana, tools.nmap, tools.naabu, tools.ffuf, tools.dalfox, tools.gitlea… |
| engine | bounty catalog served | ✓ pass | 746 برنامج (511 بمكافأة) · آخر تحديث 8.4 يوم · ops/bounty/programs-catalog.json |
| engine | catalog lookup over HTTP | ✓ pass | aces-dev.wnba.com → hackerone:nba-public (domain · استقبال open) · ونطاق مجهول → match:null |
| engine | program registered active (demo.testfire.net) | ✓ pass | id=demo.testfire.net · policy=https://demo.testfire.net/ |
| engine | job created | ✓ pass | job=20261111-38ebeb · 7 مهمة |
| engine | job executed | ✓ pass | 6/7 done · 1 failed · 11 finding · done |
| engine | failed tasks | ? review | tools.nuclei: الأداة «nuclei» مش على الجهاز self-node (exit=127). أمر التثبيت: sh -c "$(curl -sL https://raw.githubusercontent.com/projectdiscovery/nuclei/main/install.sh)" |
| engine | evidence hashed on disk | ✓ pass | 6 ملف في state/jobs/20261111-38ebeb/evidence · 6 فيهم بايتات |
| engine | report is honest about coverage | ✓ pass | 622 بايت · فيه «Coverage gaps»=true · «reportable»=true |
| engine | findings vault is idempotent | ✓ pass | أول sync: +22/-22 (من مهام 11 · من الكتالوج القديم 11) · تاني: +0/-22 ومحدّثة 22 · متأكَّدة 0 |
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
