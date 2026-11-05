# إجابات الفورمات — Render + Waifly (جاهزة للّصق)

> كل قيمة تحت مربوطة بحاجة في الريبو أو رقم مقيس. اللي مش مقيس مكتوب إنه مش مقيس.

---

## 1) Render — New Web Service (Docker)

الصفحة اللي فتحتها هي `dashboard.render.com/web/new`، والريبو اتعرف عليه لوحده.

| الحقل | القيمة |
|---|---|
| **Source Code** | `DawshaX/xFREEDOLLARHACHx` (سيبها) |
| **Name** | `cybernova-nova` |
| **Language / Runtime** | `Docker` (سيبها زي ما هي — في `Dockerfile` في جذر الريبو) |
| **Branch** | `main` |
| **Region** | `Frankfurt (EU Central)` — أقرب لمصر من Oregon، والفرق في الـlatency محسوس |
| **Root Directory** | اتركه **فاضي** |
| **Compute** | `Free` — **$0 / 0.1 CPU / 512 MB RAM** |
| **Environment Variables** | 6 متغيرات — الجدول اللي تحت |
| **Health Check Path** | `/api/health` |
| **Docker Build Context Directory** | فاضي (الافتراضي = جذر الريبو) |
| **Dockerfile Path** | `./Dockerfile` |
| **Docker Command** | فاضي (صورة الدوكر عندها `CMD` جاهز) |
| **Pre-Deploy Command** | فاضي |
| **Auto-Deploy** | `On Commit` (سيبها) |
| **Included Paths / Ignored Paths** | فاضية |

### متغيرات البيئة (انسخهم واحد واحد)

| Key | Value | ليه |
|---|---|---|
| `NODE_ENV` | `production` | من غيرها `/` بيرجّع 404 على سيرفر صح — مقيس في #163 |
| `NOVA_EXEC_TOKEN` | *(اضغط Generate وانسخه في مكان آمن)* | التوكن اللي اللوحة بتستخدمه في `/api/ops/*` |
| `NOVA_CORPUS_AUTODOWNLOAD` | `0` | الكوربوس الكامل (10.8 MB) بيتملي على كل boot ويستهلك وقت وذاكرة |
| `NOVA_OPS_AUTONOMY` | `passive` | مفيش تنفيذ من غير أمر صريح منك |
| `NOVA_MAX_INFLIGHT` | `2` | 0.1 CPU مايستحملش أكتر من كده |
| `NOVA_FLEET_LABEL` | `render-free` | اسم الماكينة في «ماكينات نوفا» |

**متسيبش `PORT`** — Render بيحقن البورت بنفسه، والمحرك بيقراه من البيئة (ولو قيمته غلط بيرجع لـ8080 مع تحذير، مش بيموت — ده اتصلّح في #166).

### بعد النشر

1. الرابط هيبقى حاجة زي `https://cybernova-nova.onrender.com`.
2. افتح `https://cybernova-nova.onrender.com/api/health` — لازم ترجع `{"status":"ok"}`.
3. الخطة المجانية بتنام بعد 15 دقيقة بدون زيارات؛ `.github/workflows/keepalive.yml` بيصحّيها كل 10 دقايق.

**الحقيقة عن الخطة المجانية:** 512 MB / 0.1 CPU / 750 ساعة شهريًا. البرنامج كامل بياخد **≈160 MB** (مقيس: `boot.mjs` 55 MB + `nova-app.mjs` 103 MB)، فالذاكرة كافية، والـCPU الضعيف هو الحد الحقيقي — عشان كده `NOVA_MAX_INFLIGHT=2`.

> لو Render رفض إنشاء الخدمة وقال إن الحساب محتاج طريقة دفع: ده قيد عندهم على الحسابات الجديدة، مش مشكلة في الريبو. ساعتها الخطة B هي Codespace (شغّال أصلًا) + Waifly.

---

## 2) Waifly — Create Server

| الحقل | القيمة |
|---|---|
| **Server Name** | `nova-hub` |
| **Egg (Server Type)** | `NodeJS` — **مش** `NodeJS + Python` ومش `NodeJS + Python + FFmpeg` |
| **Location** | `France - Paris 1 (FR1)` — لأن FR2 ممتلئ وFR3 مدفوع |
| **السلوت** | 1 slot = 300 MB RAM · 30% CPU · 1024 MB disk |

### ليه NodeJS بالظبط

البرنامج محتاج Node 22 وبس. `NodeJS + Python` بيحجز بايثون في نفس الـ300 MB من غير أي استخدام، والذاكرة هي أضيق مورد عندك:

- مقيس للبرنامج كامل: **≈160 MB** من 300 MB (يعني ≈140 MB فاضيين).
- البناء (`pnpm install` + `vite build`) محتاج ≈1.5 GB — **مستحيل على السلوت ده**. عشان كده **متبنيش على Waifly أبدًا**: تنزّل الباندل الجاهز `nova-24-7.zip` (2.6 MB / 126 ملف) وتفكّه.

### بعد الـCreate (في تبويب Console بتاع السيرفر)

```sh
sh -c "$(curl -fsSL https://raw.githubusercontent.com/DawshaX/xFREEDOLLARHACHx/main/deploy/machines/waifly-bootstrap.sh)"
```

السكربت بيعمل 4 حاجات: ينزّل الباندل، يفكّه في `$HOME/app`، يكتب `.env` بتوكن عشوائي + `NOVA_OPS_AUTONOMY=passive` + `NOVA_MAX_INFLIGHT=2`، وينضّف `state/jobs` الأقدم من 7 أيام. وفي الآخر بيطبع:

```
Start Command: sh $HOME/app/start.sh
```

حطّ الـ**Start Command** ده في حقل Startup Command في لوحة Waifly، وشغّل. الحالة المتوقعة:

| القياس | القيمة |
|---|---|
| `/api/health` | 200 · `{"status":"ok","wsConnected":true}` |
| `/` (اللوحة) | 200 |
| `/api/ops/kinds` | 200 (بالتوكن) |
| RSS | ≈160 MB من 300 MB |

بعد ما يشتغل: خد الرابط من لوحة Waifly → الضيفه في «ماكينات نوفا» في `/nova-fleet` → اضغط **استخدمه**، وهيبقى هو محرك الأسطول.

---

## 3) دمج التلاتة في الأسطول

كل الماكينات بتتسجّل في مكان واحد جديد: بطاقة **«ماكينات نوفا»** فوق صفحة `/nova-fleet`.

1. Codespace: اكتب اسمه بس — `animated-broccoli-gwx6wgpxvx5hv6gj` — والكارت بيبني الرابط `https://<name>-8080.app.github.dev` لوحده.
2. Render: الصق الرابط اللي Render اداه لك.
3. Waifly: الصق الرابط من لوحته.

كل واحدة بتتقاس بـ`/api/health` **فعليًا** قبل ما تتكتب «شغّال»، والفشل بيتقال بسببه:

| الرسالة | معناها | الحل |
|---|---|---|
| النطاق مش موجود | الرابط غلط أو السيرفر متمسح | راجع الرابط |
| البورت مقفول | الخدمة مش شغّالة | شغّل `start.sh` |
| مردّش في الوقت | نايم (Render المجاني بينام) | الـkeepalive أو صحّيه |
| مفيش اتصال من المتصفح | السيرفر شغّال بس البورت مش Public | Codespace: Ports → 8080 → Public |

بعد ما تسجّلهم، الصفحة بتعرضهم كـ**nodes من نوع machine** في المِش جانب «نوفا · الدماغ»، وده مربوط على السيرفر نفسه via `POST /api/fleet/servers/sync` — يعني القايمة موجودة في المتصفح وفي المحرك.
