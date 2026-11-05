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

### ٣) اضبط Start Command
روح تبويب **Startup** (أو Settings) → خانة **Startup Command** → امسح اللي فيها وحطّ بالظبط:

```sh
sh nova-24-7/start.sh
```

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

## لو حصلت مشكلة

| العرض | السبب | الحل |
|---|---|---|
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
