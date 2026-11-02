# التحقق الحي — إزاي NOVA بتثبت إن أدواتها شغالة فعلاً

> الملف ده إجابة سؤال واحد: **«كل حاجة شغالة حقيقية 100% وموثقة ومربوطة بمواقع حية؟»**
> الإجابة مبنقتولهاش — بتتقاس. `scripts/verify-live.mjs` بيشغّل الأدوات الحقيقية
> والسلسلة الحقيقية على أهداف حية، و`.github/workflows/live-verify.yml` بيشغّله
> كل 6 ساعات على جهاز GitHub Actions، والنتيجة بتتعملها commit في `state/verified-live.md`.

---

## 1) ليه القياس ده بالذات

المحرك كامل من جوه: 13 نوع مهمة، بوابة نطاق، throttle، دلائل بـ SHA-256، تقارير.
لكن «الكود موجود» مش نفس «نuclei طلع نتيجة على موقع حقيقي». الفرق ده مكانش بيتقاس
من جوه الـSandbox (مفيش خروج للإنترنت خالص — DNS بيوصل، الـTCP لأ: متوثق في أول سطر
من تقرير القياس). فالآلة اللي بتقاس عليها هي **GitHub Actions**: 4 نوى، sudo،
إنترنت مفتوح، بلا تسجيل وبلا بطاقة — وهي بنفسها «السيرفر المجاني» اللي المشروع
شغال عليه أصلاً (`docs/GITHUB-AS-THE-SERVER.md`).

## 2) الطبقتان — لأنهما بيقعوا بطريقة مختلفة

| الطبقة | بتقيس إيه | لو وقعت معناها |
|---|---|---|
| **CLI** | إن الباينري موجود وبيعرف يشتغل: `dnsx`/`getent`، `subfinder`، `httpx`، `katana`، `nuclei -ut`، `nmap` أو `naabu`، `ffuf` | الـ**vendor** فشل (`scripts/fetch-toolchain.mjs`) — مشكلة تنزيل، مش مشكلة منطق |
| **ENGINE** | نفس الأدوات من غير shell: `POST /api/ops/programs/discover` بجملة الإذن الحرفية ← `POST /api/ops/jobs` (deep + tools) ← polling ← الدلائل على القرص ← التقرير | المنطق/البوابة/المسار مكسور — ودي الغالية |

الأداة اللي تشتغل في الـshell وما تشتغلش جوه السلسلة دي مش feature — دي demo.

## 3) السيطرة السلبية (السطر الأهم في الملف كله)

قبل أي احتفال: القياس على `example.com` — مفيش له إذن — **لازم يترفض**.
في آخر تشغيل محلي طلع كده بالحرف:

```
✓ engine | negative control refuses example.com | HTTP 403
  برنامج Negative control محدد passive_only — استطلاع ومصادر عامة بس، من غير لمس الخدمة.
  للتفعيل لازم تأكيد إذن مكتوب: program_discover مع activate = "I have written permission for …"
```

لو السطر ده بقى ✗ يومًا ما، فده معناه إن البوابة اتفتحت — ومش هنقول «الأدوات لسه
ما اتظبطتش»، هنقول «اقفوا كل حاجة». عشان كده `verdict` بيطلع **UNSAFE** بدل RED في
الحالة دي، والـworkflow بيرمي `::error::`.

السيطرة السلبية مدسوسة في ملف البرامج اللي الـworkflow بيعمله نفسه
(`negative-control` · `passive_only: true` · `enabled: true`) — فلو البوابة سايبة،
الفحص بيتقبل من أول سطر.

## 4) الأهداف — وإذن كل واحد (مش كرم، وثيقة)

| الهدف | ليه مسموح | التوقع |
|---|---|---|
| `scanme.nmap.org` | مضيف مخصص لاختبار nmap؛ صاحبه (Gordon Lyon) كاتب صراحة إن المسح مسموح — <https://scanme.nmap.org/> | منفذا 80 و22 مفتوحين، HTTP 200 |
| `testphp.vulnweb.com` | موقع Acunetix التجاري المفتوح للاستخدام مع الماسحات — <https://www.acunetix.com/vulnerability-scanner/webscantest/> | HTTP 200، crawl > 0، نتائج nuclei متوقعة (موقع مقصود فيه ثغرات) |
| `demo.testfire.net` | IBM AppScan demo — مبني عشان يتفحص — <https://demo.testfire.net/> | HTTP 200 + crawl |
| `vulnweb.com` | تعداد subdomains من مصادر عامة (DNS/شهادات) — بيلمس سجلات مش الخدمة | subdomains ≥ 1 |
| `example.com` | **مفيش** — سيطرة سلبية | رفض من البوابة |

الحarness بيرفض أي هدف مش في `ops/verify/targets.json` — فالغلطة المطبعية في هدف
ماتحولش المسح من «مأذون» لـ«عدوان من عنوان GitHub».

## 5) معنى الحالات الأربع

- **pass** — اتقاس وتحقق.
- **fail** — اتقاس وطلع وحش. أدوات مش موجودة = fail، مش بلوك.
- **blocked** — الشبكة/الهدف ماردّوش. مش إثبات إن الأداة بايظة ولا إنها سليمة.
- **review** — الأداة اشتغلت والتوقع ما اتحققش النهارده (موقع بيتصلح، أو سياسة اتغيرت).

والحكم العام: `RED` لو في fail · `UNSAFE` لو السيطرة السلبية وقعت · `AMBER` لو
فيه review · `NO_NETWORK` لو كل الأسطر blocked · `GREEN` غير كده.
الـworkflow **ما بيفشلش البناء** على الأحمر — الأحمر بيانات لازم تتقري، مش لوج بيختفي.

## 6) شغّله بنفسك

```bash
# على جهاز فيه خروج للإنترنت (مش الـSandbox):
node scripts/fetch-toolchain.mjs --into vendor/bin     # الأدوات
sudo apt-get install -y nmap                           # اختياري — naabu بيكفي
NODE_ENV=production SERVER_PORT=8090 HOST=127.0.0.1 \
  NOVA_EXEC_TOKEN=$(node -e 'console.log(require("crypto").randomBytes(12).toString("hex"))') \
  NOVA_PROGRAMS_FILE=/tmp/nova-programs.json \
  node artifacts/api-server/dist/index.mjs &
node scripts/verify-live.mjs --engine http://127.0.0.1:8090/api --token "$NOVA_EXEC_TOKEN"
```

أو من غير أي سيرفر: `node scripts/verify-live.mjs --skip-engine` (الطبقة CLI بس).
الفلاجات: `--targets --engine --token --out --markdown --stateDir --timeout --tools-only --skip-cli --skip-engine`.

## 7) إيه اللي القياس ده مش بيدّعيه

- **مابيقولش «هلاقيت ثغرات عند ناس»**: التوقعات كلها على أهداف أصحابها قالوا افحصوني.
  لما NOVA تدخل برنامج bug-bounty حقيقي (HackerOne/Bugcrowd) النطاقات بتاعتهم بتدخل
  من نفس بوابة `program_discover` + جملة الإذن الحرفية — والقواعد نفسها اللي بتخلي
  السيطرة السلبية ترفض هي اللي هتمشي هناك.
- **مابيقولش إن IP بيبقى «نظيف»**: المنافذ النشطة من عنوان GitHub مركز البيانات —
  ناس كتير تشلّه. عشان strike حقيقي بهدوء تحتاج نود فيه root (`freevps.edu.pl` /
  GratisVPS) — وده لسه محتاج حساب من صاحب الجهاز، مش حاجة أقدر أعملها لوحدي.
- **مابيقولش 100% للأبد**: التوقعات بتتغير لأن المواقع بتتصلح. لو `testphp` اتقفل
  هيطلع review/fail — وده معناه إن القياس اشتغل، مش إنه فاشل.
- آخر قياس حقيقي بيتخزّن بتوقيته في `state/verified-live.json`، و`awareness` بيقرأه:
  عضو `liveverify` في `/api/nova-core/awareness` بيقول «مقاس من ساعتين: 9✓ / 1✗» أو
  «سلسلة الأدوات ما اتقاستش على أهداف حية لحد دلوقتي» — من غير ملف تقرير مفيش ادعاء.

## 8) ليه القياس بيعدّي على القرص أصلاً

`state/verified-live.json` + `.md` بيعملهم commit البوت (`nova-verify-bot`) بنفس الحيلة
اللي اثبتت شغل في `free-host-survey.yml`: `workflow_dispatch` مقفول (403) أمام
التوكن ده، فـ**push على ملفات القياس نفسه** هو زر التشغيل، والحارس
`if: ${{ !(github.event_name == 'workflow_dispatch' && inputs.commit == false) }}`
بيضمن إن الجدول نفسه بي publish — مش بيكتب في لوج محدش بيقراه.

**أول تشغيل حقيقي بعد الدمج**: عدّل/امسك `scripts/verify-live.mjs` أو سيّب الـcron
يمشي — وبعد ~3 دقايق `git show origin/main:state/verified-live.md` هيديك الرد.
