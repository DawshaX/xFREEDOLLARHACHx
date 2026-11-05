# المضيفون المجانيون — واقع 2026، مقاس مش محكي

> الصفحة دي مكتوبة بعد ما اتقارن كل سطر فيها بموقع المورد نفسه في **2026-11-02**.
> اللي ماتحققتش منه النهاردة مكتوب صريح «مش متحقق». والمصدر الحي للأرقام دي:
> `curl <hub>/api/fleet/catalogue?probe=1` وشغل الـworkflow `free-host-survey.yml`.

## 1) القاعدة اللي اتغيرت في 2026

كل «backend مجاني بيفضل صاحي» في العالم مات أو بينام:

| المورد | الوضع في 2026 | مصدر التحقق |
|---|---|---|
| **Cyclic.sh** | **مات** — القدام free tier اتقفل 10 مايو 2024 وكل حاجة 31 مايو 2024 | صفحة الإيقاف عندهم |
| **Glitch** | قفل الاستضافة | مقارنات 2026 |
| **Heroku** | مفيش مجاني من 2022 | مقارنات 2026 |
| **Fly.io** | **مفيش مجاني لحساب جديد** — تريال 2 ساعة VM أو 7 أيام وبعدين كارت (الخطة القديمة لسه شغالة للقديم بس) | saaspricepulse + techsy (2026) |
| **Koyeb** | الحسابات الجديدة بتتحول لـPro ($29/شهر)؛ الـfree instance بقى على الخطط المدفوعة | toolfreebie (سبتمبر 2026) |
| **Railway** | $5 أول شهر و$1 كرِدِت/شهر — مش كفاية لـ24/7 | صفحة Render الرسمية للمقارنة |
| **Render** | مجاني لسه (750 ساعة/شهر) بس خدمة الويب المجانية **بتنام بعد 15 دقيقة** والصحوة ~دقيقة، والـbandwidth اتقصّف من 100GB لـ**5GB** في أبريل 2026، والـPostgres المجاني بيموت بعد 30 يوم | مقال Render نفسه + livemy.app |
| **Cloudflare Workers** | مجاني وسريع بس **10ms CPU للطلب ومفيش عملية دائمة** — يستحيل يشغّل `nova-agent` ولا daemon | وثائقهم |
| **Oracle Always Free** | أقوى حاجة فاضلة: ARM لحد 4 OCPU/24 جيجا (ومصادر بتقول اتقصّف لـ2/12 في يونيو 2026) + ديسك 200 جيجا + 10TB خرج، **دائم فعلًا** — بس بطاقة للمصادقة، وبتستلم أمورك لو قعدت خامل | صفحة أوراكل + مقارنات 2026 |

والنتيجة: المجاني اللي **ماينامش** بقى في ضلعين بس — (أ) VPS/حاوية من مقدم صغير (ثقة أقل، سعة أقل)، أو (ب) سحابة كبيرة بتطلب بطاقة. مفيش تالت.

## 2) اللي اخترناه لـNOVA (ومقسوم بالوظيفة، مش بالاسم)

| الوظيفة | أحسن خيار مجاني | ليه | شروط/مصائب |
|---|---|---|---|
| **الـhub (العقل + المجلس + البث + الذاكرة)** | **Silly Development** (sillydev.co.uk) | 256MB · 25% core · 512MB ديسك · **مفيش نوم ولا تجديد ولا كارت** · وفيه **Postgres/MariaDB مجاني** | لو السيرفر مااتستخدموش في أول 7 أيام بيتشيل (بعد إيميل تحذير) · مافيهمش أدوات تقيلة |
| **نود تقيل فيه root وديسك** | **GratisVPS.net** | **2 vCPU / 2 GB RAM / NVMe / root SSH / بلا كارت** (الموقع بيعيش على الإعلانات) — أقدر بكتير من أي PaaS | شروطهم بتمنع صراحة «port scanning / brute-forcing / DDoS» → **ممنوع أي ضربة نشطة من هنا** · IPv4 مشترك |
| **نود طالب/مطور بـroot** | **FreeVPS.edu.pl** | KVM دائم، Ryzen 9، قبول فوري ببريد `.edu` ومراجعة GitHub للمطورين — يعني حسابك على GitHub هو مفتاحك | سياسة المسح مش معلنة → اسأل، ومن غير رد: passive |
| **سعة كبيرة لو عندك بطاقة** | **Oracle Always Free** | ARM كامل + systemd + أي أداة (nmap/nuclei/subfinder) + 200 جيجا | بطاقة للمصادقة · instance خامل ممكن يتسحب · محتاج تكون الأدمن |
| **كرِدِت من غير بطاقة للطلاب** | **Azure for Students** | $100 و«لا يطلب بطاقة»، بيتجدد طالما أنت طالب، VM كامل | AUP بتمنع فحص شبكات ناس تانية من غير إذن مكتوب · 12 شهر |
| **أسطول لحظي بقوة ضخمة** | **GitHub Actions** (موجود في الريبو: `fleet-nodes.yml`) | 4 نواة / 16 جيجا لكل job، ومجانًا للريبو العام | جلسة 6 ساعات → موجات متجددة، مش دائم · مفيش منفذ عام |
| **الوش** | **GitHub Pages** (موجود: `deploy-pages.yml`) | دائم ومجاني ومفيش سيرفر | مفيش محرك → اللوحة بتقول «معلومة ناقصة» بدل ما تختلق أرقام |

## 3) وصفة Silly Development (اللي ينفع دماغ لـNOVA)

```bash
# بعد ما تعمل Server (Node.js) من البانل، في الكونسول:
curl -L -o nova.zip https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-portable/nova-24-7.zip
unzip nova.zip && cd nova-24-7
export PORT=$PORT                       # البانل بيحددهولك
export NOVA_EXEC_TOKEN="$(openssl rand -hex 16)"
echo "NOVA_EXEC_TOKEN=$NOVA_EXEC_TOKEN"   # اكتبه في Secrets في الريبو كمان
node server.mjs
curl -s localhost:$PORT/api/nova-core/awareness | head -c 300   # لازم: "opsRouter": true
```

**لو فتحولك Postgres مجاني** (قاعدين ×50MB، «تتوصل بيها من أي حتة»): صدّر `DATABASE_URL`.
السيرفر بيراجع المتغير ده فعلًا (`src/index.ts` و`src/app.ts`): من غيره الوضع مستقل والذاكرة على
الديسك (اللي بيتّمسى مع كل deploy على Silly/Render)؛ بتاعه بقى دايم والمهمات والمكتبة على قاعدة بيانات.
كمان ضيف `NOVA_PROGRAMS_FILE=/data/programs.json` عشان سجل التصريح يعيش.

HTTPS عشان تربط اللوحة اللي على Pages بالمحرك: `sh start-tunnel.sh` (Cloudflare quick tunnel، من غير تسجيل) —
ونفس اللوحة هتلاقي `hub` بتاعها في «المخ · المدير».

## 4) وصفة GratisVPS (نود بـ2 جيجا أو hub تقيل)

```bash
ssh root@<IP-اللي-جابوه>
apt update && apt install -y nodejs npm git curl unzip
curl -L -o nova.zip https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-portable/nova-24-7.zip
unzip nova.zip && cd nova-24-7
printf 'PORT=8080\nHOST=0.0.0.0\nNOVA_EXEC_TOKEN=%s\n' "$(openssl rand -hex 16)" > .env
npm i -g pm2 && pm2 start "node server.mjs" --name nova && pm2 save && pm2 startup
# نود للأسطول بدل hub:
curl -fsSL http://<hub>/api/local-agent/download-nova-agent -o nova-agent.js
NOVA_SERVER=ws://<hub>/api/local-agent/ws node nova-agent.js --id gratisvps-1 --allow recon,intel
```

**اقرأ كمان:** أي حاجة نشطة (nmap/nuclei/فحص منافذ/تجربة SQLi) علىضيف ده **ممنوع في شروطه** —
وحتى لو مكانش، أي IP مشترك على مستضيف مجاني = بصمتك بتاعت الناس التانيين. الضرب النشط على
نودك أنت، أو Oracle، وبعد جملة الإذن المكتوبة `I have written permission for <host>`.

## 5) إزاي تتأكد إن الكلام لسه صحيح (ده المهم مش الحفظ)

```bash
node scripts/free-host-survey.mjs                      # قياس مباشر من مكانك
node scripts/free-host-survey.mjs --url http://127.0.0.1:8080   # نفس كود القياس بتاع المحرك
# أو من جيت-هاب: Actions → free-host survey → Run workflow
```

النتيجة بتتكتب في `state/free-hosts.md` + `state/free-hosts.json` (الـworkflow بيعمل commit
بعلامة `[host-survey]`) — فلو المورد بطل، الأرقام في الريبو هي اللي هتتغير مش الروايات.

> **تحذير مخرج:** sandbox التطوير هنا **مفيش منه أي خروج** لغير npm/pypi/GitHub — فلو شغّلت
> المسح جواه هتلاقي 14/14 `ECONNRESET` ودي مش إجابة عن المضيفين، دي إجابة عن الصندوق.
> القياس الصح بيتم من الـCI أو من السيرفر المنشور.

## 6) اللي الريبو بقى بيعمله بالبيانات دي

- `src/lib/ops/free-hosts.ts` — الكتالوج + `scanPolicy` + `status2026` + `probeUrl` لكل مورد.
- `GET /api/fleet/catalogue?probe=1` — ادّعاء + قياس حي (كاش 10 دقايق، GET واحد، مفيش كتابة).
- عضو **`freehosts`** في `/api/nova-core/awareness`: كام موقع بيردّ، كام بلا بطاقة، كام يصلح hub، والأحسن دلوقتي.
- شريط **«البدائل المجانية للمضيف»** في غرفة العمليات بـ`/nova-fleet` — بنفس الأرقام، مع زرار «قيس تاني».

---

### Render بقى «مكان واحد» أكتر مما كان

`scripts/fetch-toolchain.mjs` بقى جزء من الـbuild جوه `render.yaml`: بينزّل nuclei/httpx/subfinder/
katana/dnsx/naabu/ffuf كـbinaries ثابتة في `vendor/bin`، و`findBinary()` بيبحث هناك (أو في
`NOVA_TOOL_DIR`). يعني Render Free — اللي مافيهوش SSH ولا apt — بقى ينفّذ مهام الأدوات فعلاً،
واللي مالوش لسه: `nmap` (استخدم `naabu`) وdisك دائم واللمسة النشطة على أهداف البرامج.
التفاصيل: `deploy/render-free-guide.md`.

#### من 2026-11-05: التنزيل بقى خطوة **تشغيل** كمان، مش بناء بس
السلوت المجاني اللي بيجري `nova-24-7.zip` (Waifly/Pterodactyl) مابيعملش build، فـ`vendor/bin`
كان بيفضل فاضي والأدوات «مش موجودة» للأبد. بقى:

```
GET  /api/ops/tools              → present/missing/writable/scriptAvailable + آخر محاولة (مقاسة من القرص)
POST /api/ops/tools/provision     → بينزّل النسخ الثابتة (بلا root، بلا shell) — ورا NOVA_EXEC_TOKEN أو نفس الأصل
```

- للمحرك نفسه: أداة `tools_install` (يقولها المستخدم في الشات «ثبّت nuclei» فتعملها).
- عند الإقلاع: `NOVA_TOOLCHAIN_FETCH=1` (أو `auto` = بس لو المجلد فاضي). **مطفي افتراضيًا**:
  ~100 MB على قرص 512 MB مع كوربوس منزّل للتو = مخاطرة OOM على مضيف مجاني.
- الحزمة بقى تنسخ `ops/` + `scripts/fetch-toolchain.mjs` جوّاها (`build-standalone.mjs`)،
  و`audit-route-integrity` بيحمّر لو أي ملف بيانات بيتقرا وقت التشغيل اتنسي من الباندل.

**بسبب نفس المرحلة:** `POST /api/network/scan` و`/api/system/run` و`/api/terminal/exec` و
`/api/shell/exec` و`/api/tools/install` و`/api/fleet/broadcast` و`/api/kali-command/*exec*`
و`/api/nova/workspace/{exec,write}` و`/api/nova/scheduler/run` و`/api/installer/tools/:id/install`
— كلها كانت **بتنفّذ بلا هوية**. دي ورا البوابة دلوقتي: لو سيّرت `NOVA_EXEC_TOKEN` ابعت
`x-nova-token`، وإلا الطلب لازم يجي من نفس الأصل (لوحة `/nova-fleet` شغالة عادي).
المربوط من Pages على `dawshax.github.io` هيكسر في المسارات دي بالظبط — وده مقصود:
ماقدرش أسيب shell مفتوح للعامة. الحل: حقل التوكن في غرفة العمليات (`المخ · المدير`).


## «مكان واحد يغنينا عن كل ده» — الإجابة المختصرة

جرّبت المرشحين اللي بيقولوا كده، ونجّفتهم النهارده (2026-11-02):

- **Qoddy**: كارت ائتمان إلزامي للتوثيق حتى للخطة المجانية — مسجّل بنفس الشرط في 2023 و2025 و**2026-08-28**.
- **Sealos**: لا خطة مجانية في 2026، تجربة 7 أيام ثم $7/شهر.
- **Hugging Face Spaces**: من 2026 إنشاء Space بـDocker محتاج PRO ($9) — وكمان الخرج متقفل على 80/443/8080، فمسح البورتات مستحيل، والنوم بعد 48 ساعة سكون.
- **Cloudflare Containers**: يحتاج Workers Paid ($5/شهر)، و375 دقيقة vCPU في الشهر ما تشيلش عملية 24/7.
- **Oracle Always Free**: يجمع كل حاجة تقريباً (Arm، root، 200 GB ديسك، بلا نوم) بس كارت للتوثيق + سحب للأمثلة الخاملة + تسجيل بيفشل من مصر كتير.

اللي بيدي الاختبارات كلها من غير كارت هو **جيت-هَب نفسه**: Pages (عنوان دائم + HTTPS) + Actions
(جهاز 4 أنوية/16 جيجا بـ`sudo`، دقائق غير محدودة على ريبو عام) + Releases/Artifacts (تخزين).
اللي مالوش: منفذ عام يستقبل، وjob بيموت بعد 6 ساعات — فالصندوق الصغير (Waifly/Silly) فضل «صندوق بريد»،
والشغل التقني بقى في الطابور: `state/nova-queue.json` → `nova-runner.yml`.
التفاصيل الكاملة والعقد والقياسات: **`docs/GITHUB-AS-THE-SERVER.md`**.

