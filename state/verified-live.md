# التحقق الحي — الأدوات والسلسلة الكاملة على أهداف مسموح بها

> اتولّد من `scripts/verify-live.mjs` (شغّله `.github/workflows/live-verify.yml`).
> كل هدف هنا صاحبه منشور صراحة إن فحصه مسموح — الوثيقة في العمود الأخير.

آخر تشغيل: `2026-11-19T21:03:24.640Z` · الحكم: **AMBER** · ✓20 · ✗0 · ؟4 · (محجوب)0
الأدوات المرصودة: dnsx, subfinder, httpx, nuclei, katana, nmap, naabu, ffuf · المحرك: `http://127.0.0.1:8090/api` · هدف التمرين: `scanme.nmap.org`

| الطبقة | الفحص | الحالة | التفصيل |
|---|---|---|---|
| cli | dns resolution (getent — the resolver, not the scanner) | ✓ pass | 2600:3c01::f03c:91ff:fe18:bb2f scanme.nmap.org · dnsx=present |
| cli | subfinder -d vulnweb.com | ✓ pass | 519 سوبدومين (المطلوب ≥2) · 0l9l.vulnweb.com, tuubalme.vulnweb.com, cart.vulnweb.com |
| cli | httpx https://demo.testfire.net/ | ? review | status=مفيش (المطلوب 200) · exit=0 · 0B · السبب: مفيش مخرجات · مفاتيح الرد: مفيش JSON · 951ms |
| cli | katana crawl testphp.vulnweb.com | ✓ pass | 1 رابط متكرول (المطلوب ≥1) |
| cli | nuclei -u testphp.vulnweb.com (high,critical) | ? review | 4 طلب اتفحص (المطلوب >50) و0 نتيجة high/critical · exit=0 |
| cli | nmap scanme.nmap.org:80,22 | ✓ pass | 2 بورت مفتوح · 22/tcp open · 80/tcp open |
| cli | hub  | ? review | /api/health → HTTP 000 · بلا رد · ops/version بلا رد · 17ms · السبب: TypeError Failed to parse URL from /api/health ERR_INVALID_URL |
| cli | ffuf fuzz testphp.vulnweb.com | ✓ pass | 61 طلب مُرسل و0 مطابقة (1 سطر مخرجات) |
| engine | engine reachable | ✓ pass | HTTP 200 |
| engine | kinds report tool presence | ✓ pass | 27 نوع شغال على النود: recon.dns, recon.tls, recon.headers, recon.ports, recon.certspotter, infra.freehosts, recon.securitytxt, recon.jspaths, intel.cvebytech, intel.advisories, intel.corpus, tools.nuclei, tools.httpx, tools.subfinder, tools.katana, tools.nmap, tools.amass, tools.naabu, tools.ffuf,… |
| engine | bounty catalog served | ✓ pass | 745 برنامج (509 بمكافأة) · آخر تحديث 3.2 يوم · ops/bounty/programs-catalog.json |
| engine | catalog lookup over HTTP | ✓ pass | aces-dev.wnba.com → hackerone:nba-public (domain · استقبال open) · ونطاق مجهول → match:null |
| engine | program registered active (demo.testfire.net) | ✓ pass | id=demo.testfire.net · policy=https://demo.testfire.net/ |
| engine | job created | ✓ pass | job=20261119-da370b · 7 مهمة |
| engine | job executed | ✓ pass | 5/7 done · 2 failed · 4 finding · done |
| engine | failed tasks | ? review | recon.headers: الطلب لـdemo.testfire.net موصّلش (Error: connect ECONNREFUSED 65.61.137.117:443) — النتيجة «مجهولة» مش «ناقصة» · recon.tls: handshake لـdemo.testfire.net فشل (Error: connect ECONNREFUSED 65.61.137.117:443) — مفيش استنتاج عن الشهادة |
| engine | evidence hashed on disk | ✓ pass | 4 ملف في state/jobs/20261119-da370b/evidence · 3 فيهم بايتات · فاضي: tools.httpx-e3b0c44298fc.txt (1 — 1 منها صفر مخرجات بحاشية الفراغ، و0 مفاقيد فعلية) |
| engine | report is honest about coverage | ✓ pass | 668 بايت · فيه «Coverage gaps»=true · «reportable»=true |
| engine | findings vault is idempotent | ✓ pass | أول sync: +4/-15 (من مهام 4 · من الكتالوج القديم 11) · تاني: +0/-15 ومحدّثة 15 · متأكَّدة 0 |
| engine | report draft gated on reproduction | ✓ pass | 3 مفتاح: 0 مسودة (200) · 3 مرفوضة (409) · البنية=true · سبب الرفض موجود=true |
| engine | hunt candidates stay context-only | ✓ pass | 12 مرشّح من 745 برنامج · أعلى استجابة 100% · مفلوت {"notBounty":236,"pausedOrClosed":0,"lowEfficiency":374,"platform":0,"query":0} · CIDR سياق بس=true · ترتيب=true |
| engine | negative control refuses example.com | ✓ pass | HTTP 403 · برنامج Negative control (must never be scanned actively) محدد passive_only — استطلاع ومصادر عامة بس، من غير لمس الخدمة. للتفعيل لازم تأكيد إذن مكتوب: program_d… |
| engine | fleet agents registered | ✓ pass | 1 عقدة (self-node) |
| engine | council llm seats answer | ✓ pass | 5 مقعد · chat HTTP 200 · delta ✓ (pollinations:openai-fast, ovh-llama, pollinations:mistral) |

## الإذن لكل هدف (مش كرم — وثيقة)

- `scanme.nmap.org` — مضيف مخصص لاختبار nmap — صاحبه (Gordon Lyon) كاتب صراحة إن المسح مسموح · [السياسة](https://scanme.nmap.org/)
- `testphp.vulnweb.com` — موقع اختبار Acunetix — منشور للاستخدام مع الماسحات (nuclei/zap/burp) في وثائقهم · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- `demo.testfire.net` — تطبيق اختبار IBM العام (AppScan) — مبني عشان يتفحص · [السياسة](https://demo.testfire.net/)
- `vulnweb.com` — نطاق اختبار عام لتعداد النطاقات الفرعية (مصادر DNS/شهادات — بيلمس سجلات مش خدمة) · [السياسة](https://www.acunetix.com/vulnerability-scanner/webscantest/)
- **سيطرة سلبية**: أي فحص نشط على `example.com` لازم **يترفض**. لو السطر ده بقى ✗ فده مكسور في البوابة، مش في الأدوات.

_«blocked» = الشبكة/الهدف ماردّوش — مش إثبات إن الأداة بايظة. «review» = الأداة اشتغلت بس التوقع ما اتحققش النهارده (موقع إصلاح ثغراته أو تغيير سياسة)._
