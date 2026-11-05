# Waifly — سيرفرك `53a7d0cb` خطوة بخطوة

> كل قيمة هنا من لوحة Waifly نفسها (المقاس 2026-11-05)، مش من الذاكرة.

| الحاجة | القيمة |
|---|---|
| Panel | `https://panel.waifly.com/server/53a7d0cb` |
| الملفات | `https://panel.waifly.com/server/53a7d0cb/files` |
| Web Address | `node.waifly.com:27316` |
| Node / Location | **PAR1** · Paris, France — **FR01** |
| السلوت | 300 MB RAM · 30% CPU · 1024 MB disk · **Active** |
| Egg | **NodeJS** |

---

## الحالة: شغّال فعلًا ✅ (مقاس 2026-11-05 · 01:44Z)

| القياس | القيمة |
|---|---|
| `GET http://node.waifly.com:27316/api/health` (من برّه) | **200** · `{"status":"ok","mode":"standalone","wsConnected":true}` |
| اللوحة `GET /` | **200** — بتعرض 168,682 ثغرة والـThreat Gauge شغّال |
| الكوربوس | اتنزّل تلقائيًا **16.20 MB** · 168,682 CVE |
| الماكينات في الأسطول | `up 2 · down 0` — الـCodespace (277 ms) وWaifly (11 ms) |
| الإصدار | `11301f4` واتحدّث لوحده عبر self-update (`attempts: 1`) |
| الـStartup Command اللي اشتغل | `sh /home/container/run` (الملفات مفكوكة في جذر `/home/container` مباشرة) |

> **ملحوظة على المسار:** نسختك مفكوكة في **جذر** `/home/container` (مش جوه مجلد `nova-24-7`)،
> والـself-update بيحدّث `/home/container` افتراضيًا — يعني ده متوافق والتحديثات الجاية هتوصل لوحدها.

---

## الملف اللي هترفعه

**`nova-24-7.zip`** — 2.6 MB · 126 ملف · البرنامج كامل (المحرك + اللوحة) جاهز للتشغيل، **مفيش بناء على السيرفر**.

التحميل (دوس على الرابط ده على جهازك):

```
https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/nova-portable/nova-24-7.zip
```

> لو الرابط ده رجّع صفحة 404، افتح `Releases` في الريبو → `nova-portable` → نزّل `nova-24-7.zip`.
> الحجم النهائي المتوقع بعد فك الضغط: **10.8 MB** من 1024 MB.

---

## الخطوات في لوحة Waifly (3 دقايق)

### ١) ارفع الملف
افتح تبويب **Files** → دوس **Upload** (أو اسحب الملف وارميه في النافذة) → اختار `nova-24-7.zip` → استنى لحد ما يخلص.

### ٢) فك الضغط
اطلع على `nova-24-7.zip` في قايمة الملفات → **كليك يمين** → **Unarchive** (أو زرار `…` → Unarchive).

النتيجة المطلوبة في `/home/container`:

```
/home/container/nova-24-7/server.mjs
/home/container/nova-24-7/start.sh
/home/container/nova-24-7/public/index.html
/home/container/nova-24-7/state/
```

> لو لوحتك مفيهاش **Unarchive**: ادخل **Console** والزاي:

```sh
cd /home/container && unzip -oq nova-24-7.zip && rm -f nova-24-7.zip && ls nova-24-7
```

### ٣) اضبط Startup Command
روح تبويب **Startup** → **Startup Command 1** → امسح اللي فيها وحطّ بالظبط:

```sh
sh /home/container/nova-24-7/run
```

- **Startup Command 2**: سيبها **فاضية**.
- **Docker Image**: **Node.js 22** (22 هي اللي اتقاس عليها؛ 24+ ممكن تشتغل بس مش مختبرة).

> **ليه `run` مش `start.sh`؟** لأن `start.sh` لما تتلصق في شات أو على الموبايل بتتحول لينك ماركداون —
> `.sh` اسم دولة حقيقي (سانت هيلينا). اللوحة بعدها بتستلم حرفيًا:
> `sh: 0: cannot open /home/container/nova-24-7/[start.sh](http://start.sh): No such file`
> وده اللي حصل فعلًا. الملف `run` مفيهوش نقطة فمستحيل يتلخبط، وبيعمل نفس الحاجة بالظبط.
>
> ملحوظة تانية من نفس اللوج: أول سطر كان `:/home/container$ /start.sh` — يعني **Startup Command 1** كان
> لسه على القيمة الافتراضية بتاعة الـegg. لازم تمسحها، من غير ما تسيب أي أمر تاني.

> **متكتبش** `npm start` ولا `node .` — الباندل مش محتاج npm ومش محتاج تثبيت أي حاجة.

### ٤) شغّل
ارجع لتبويب **Console** → **Start** (أو Restart).

هتشوف في اللوج:

```
┌─ NOVA boot ────────────────────────────
│ role      : hub (auto)
│ port      : <اللي Waifly إداه>
│ static    : /home/container/nova-24-7/public
└────────────────────────────────────────
✓ NOVA listening on http://0.0.0.0:<port>
```

### ٥) تأكيد إنه شغّال فعلًا

من جهازك (مش من السيرفر):

```sh
bash scripts/fleet-verify.sh http://node.waifly.com:27316
```

المتوقع:

```
✅ http://node.waifly.com:27316   HTTP 200 · status=ok · mode=standalone
```

ولما يبقى ✅ **مش محتاج تعمل حاجة تانية** — السيرفر مسجّل بالفعل في البرنامج باسم **«Waifly · Paris FR01»**، وهتلاقيه في صفحة `/nova-fleet` → بطاقة «ماكينات نوفا». الفحص بيحاول `http` ثم `https` لوحده، فمش مهم انهي واحد شغّال عند Waifly.

---

## ٦) دومين مجاني بـHTTPS (`https://nova.waifly.com`) — 2 دقيقة

الرابط `http://node.waifly.com:27316` شغّال، بس المتصفح بيمنع أي طلب `http` من صفحة `https`
(وده كان بيخلّي اللوحة تقول «السيرفر مش بيرد» وهو شغّال). الحل: subdomain مجاني من نفس اللوحة.

Waifly بيدّي **٢ subdomain مجانيين** لكل سيرفر (المستخدم ١/٢ في 2026-11-05).

الخطوات في `https://panel.waifly.com/server/53a7d0cb`:

1. **Network** → **Subdomains** (أو **Allocations** في بعض النسخ).
2. اكتب الاسم: `nova` — والدومين `waifly.com` (متغيّرش).
3. **Port**: `27316` — نفس البورت اللي البرنامج سامع عليه (تلاقيه في اللوج:
   `NOVA listening on http://0.0.0.0:27316`).
4. **Type**: `Web` (لو فيه اختيار `WebSocket` اختاره كمان — الشات والمِش محتاجينه).
5. Save → استنى دقيقة → افتح `https://nova.waifly.com/api/health`.

المتوقع:

```json
{"status":"ok","mode":"standalone","wsConnected":true,"timestamp":"..."}
```

بعد كده البرنامج بيسجّل الماكينة بنفسه بالـHTTPS (شفناها في `/api/fleet/system` كـ
`Waifly · HTTPS` · `up`) — مفيش أي خطوة زيادة.

**ملحوظة:** الـsubdomain التاني فاضي — لو حبيت تعمل رابط تاني (مثلاً `nova-hub`) لأي بورت
تاني في نفس السلوت، استخدمه، بس سيب الأول زي ما هو.

---

## ٧) «شُحنت نسخة والموقع لسه بيجيب القديمة» — التشخيص في سطر

دي كانت أكبر مشكلة واتصلحت في المرحلة 48 (`lib/self-restart.ts`). لو شكّيت:

```sh
curl -s https://nova.waifly.com/api/nova-core/version
```

شوف الحقلين:

- `build.commit` / `build.builtAt` = **الملفات اللي على الديسك**.
- `boot.commit` / `boot.builtAt` = **الكود اللي بيشتغل فعلًا** (بيتقري مرة واحدة عند التشغيل).

لو `stale: true` → الملفات جديدة والعملية قديمة. الحل واحد من دول:

| الطريقة | الأمر |
|---|---|
| من صفحة `/nova-fleet` | بطاقة «نظام واحد» → السطر الأحمر → زرار **«شغّل النسخة الجديدة»** |
| من المتصفح | `https://nova.waifly.com/api/nova-core/restart` (GET كفاية) |
| من اللوحة | زرار **Restart** في Waifly |

ولمتابعة اللي حصل في التحديث الأخير (مفيش أي تخمين):

```sh
curl -s https://nova.waifly.com/api/nova-core/auto-update
```

`lastResult` · `lastDetail` · `logTail` (آخر 25 سطر من `state/auto-update.log`) · `restartNeeded`.

**لو (`restartNeeded: true`) وفضل كده:** المُشرف مش شغّال، يعني السلوت متشغّل بـ
`node nova-app.mjs` مباشرة. نادِ
`https://nova.waifly.com/api/nova-core/restart?force=1` — العملية بتبدّل نفسها (بعد 3 ثواني
ترجع على نفس البورت)، ومفيش حاجة محتاجة تدخّل منك.

---

## ⛔ متضغطش «Change Language» — قبل ما تقرا السطر ده

لوحة Waifly فيها زرار **Change Language** في صفحة السيرفر. الرسالة اللي بتظهر
بتقول بالحرف: *"This triggers a reinstall on the new environment — existing files
may be lost"*. ده معناه إن **الملفات كلها بتتمسح وتتبني من جديد**، ومنها:

- الحزمة `nova-24-7` (بما فيها `nova-app.mjs` و`public/` و`boot.mjs`)
- `state/` — الذاكرة والجلسات والـ`auto-update.json`
- `.env` — المفاتيح والإعدادات (`NOVA_EXEC_TOKEN` وغيره)

**القاعدة:** السيرفر شغّال على egg **NodeJS**، وده الصح. متغيّرش الـegg عشان
تحاول تركّب PHP أو Go أو Rust — البرنامج JavaScript بالكامل.

### ولو لزم التغيير فعلًا (تغيير المزوّد نفسه، مش البرنامج)

اختار من القائمة واحد من الاتنين **بس**:

| الاختيار | ليه |
|---|---|
| **NodeJS + Python** | الأفضل. Node للبرنامج، وPython موجود لـ`deploy/live-update.py` (المُحدِّث الذاتي). |
| **NodeJS** | اللي شغّال دلوقتي. لو البايثون مش موجود، التحديث الذاتي بيحاول يفشل بنفسه (والتطبيق بيكتب الماركر بنفسه على أي حال). |

**متختارش:** `Web Hosting (PHP)` · `Python` لوحده · `Go` · `Rust Server` · `Java Server` · `Bun` · `Generic C#` —
ولا واحد فيهم هيشغّل `nova-app.mjs`.

### قبل أي تغيير، خد نسخة (5 دقايق، مجانًا)

1. **نزّل `state/`** من الـFile Manager (أو من `https://nova.waifly.com/api/nova-core/memory/export`).
2. **نزّل `.env`** لو موجود (في `/home/container/.env`).
3. بعد التغيير: ارفع زيب `nova-24-7` الجديد من الريليس، فكّه، وبعدها رجّع `state/` و`.env`.
4. تأكيد: `curl -s "https://nova.waifly.com/api/fleet/doctor?cb=1"` — لازم `ready:true` تاني.

> البديل الأرخص من أي تغيير egg: **سيب السلوت زي ما هو** واستخدم الـ`subdomain` التاني أو Codespace
> لأي تجربة.

---

## لو حصلت مشكلة

| العرض | السبب | الحل |
|---|---|---|
| `cannot open .../[start.sh](http://start.sh): No such file` | الأمر اتلصق من شات/موبايل فاتحول للينك ماركداون | استخدم `sh /home/container/nova-24-7/run` — مفيش نقطة فيه |
| `cannot open .../nova-24-7/run: No such file` | الملفات مش مرفوعة أو الزيب ماتفكّش | `ls /home/container/nova-24-7` — لازم تشوف `run` و`boot.mjs` |
| `Cannot find module '/home/container/boot.mjs'` | نسخة قديمة من `start.sh` (قبل إصلاح 2026-11-05) | هات الزيب الجديد تاني وافكّه فوق القديم |
| `Killed` / OOM بعد التشغيل | كنت بتعمل build على السيرفر | امسح `nova-24-7` وارفع الزيب بس (مفيش build) |
| اللوج سليم بس الرابط 502 | البورت اللي البرنامج سامع عليه ≠ البورت اللي الوكيل بيوجّه له | في Console: `env \| grep -i port` — لازم يكون نفس البورت اللي في اللوج |
| `unzip: not found` | egg مفيهوش unzip | اعمل الخطوة بره: نزّل الزيب على جهازك وفكّه وارفع المجلد نفسه من الـFile Manager |
| السيرفر وقف لوحده بعد أيام | Waifly بيعلّق السيرفر لو offline 3 أيام | Start، والـkeepalive بيمنع التكرار |

---

## اللي جوه الباندل (عشان تعرف إيه اللي بيشتغل)

| الملف | وظيفته |
|---|---|
| `server.mjs` | المدخل اللي أي استضافة بتناديه (`node server.mjs`) |
| `boot.mjs` | بيقرا `.env`، بيحدد الدور (hub)، بيشرف على العملية |
| `nova-app.mjs` | المحرك كامل (5.7 MB، كل الـAPI واللوحة) |
| `public/` | اللوحة مبنية |
| `start.sh` | بيظبط المتغيرات ويشغّل من أي مكان (الإصلاح الجديد) |
| `state/` | الذاكرة — عشان يعرف وقف فين بعد أي restart |

**الذاكرة:** ≈160 MB من 300 MB. **الكوربوس:** مش بيتنزّل هنا (300 MB مش هتستحمله) — الاستعلام بيروح للسحابة.
