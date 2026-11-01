# الأسطول المجاني — إزاي نوفا تبقى على أكتر من سيرفر من غير فلوس ولا فيزا

> كل رقم في الملف ده متأكد منه. أي حاجة بتطلب بطاقة مكتوب جنبها **بطاقة ❌** — مش بنسميها مجانية.

---

## 1) الحقيقة الأساسية

| نوع المورد | بيدّي إيه | العيب |
|---|---|---|
| سيرفر مجاني (Waifly / Render / Zeabur…) | جهاز واحد صغير 300–512 ميجا | محدود، وأحياناً بينام |
| **GitHub Actions على ريبو عام** | **جهاز 4 أنوية / 16 جيجا، دقايق غير محدودة** | الجلسة 6 ساعات بحد أقصى |

يعني «مليون سيرفر» مش هتجي من 1000 حساب — هتجي من **موجات** من GitHub Actions كل واحدة 19 نود، بتتجدد كل 5 ساعات. ده اللي عملناه في `.github/workflows/fleet-nodes.yml`.

---

## 2) السيرفرات المجانية اللي تنفع فعلاً

| المورد | رام | دائم؟ | بطاقة؟ | يصلح لنود؟ |
|---|---|---|---|---|
| **GitHub Actions** | 16 GB · 4 vCPU | ❌ موجة 6 ساعات | لأ ✅ | ✅ ممتاز (متجدد) |
| **Waifly** | 300 MB | ✅ 24/7 | لأ ✅ | ✅ دائم |
| **Zeabur** | رصيد $5/شهر | ✅ | لأ ✅ | ✅ دائم |
| **Back4App** | 256–512 MB | ✅ | لأ ✅ | ✅ دائم |
| **Render** | 512 MB | ❌ بينام 15 دقيقة | لأ ✅ | ⚠️ متقطع |
| **SnapDeploy** | 4×512 MB | ❌ 100 ساعة/شهر | لأ ✅ | ⚠️ متقطع |
| **Bonto** | 512 MB | ❌ 75 ساعة/شهر | لأ ✅ | ⚠️ متقطع |
| Oracle Always Free | 24 GB ARM | ✅ | **بطاقة ❌** | مستبعد |
| Koyeb / Northflank / Fly | — | — | **بطاقة ❌** | مستبعد |
| Cloudflare / Vercel / Netlify | دوال | ✅ | لأ ✅ | ❌ مش سيرفر |

القائمة دي متاحة حيّة من الـ API:

```bash
curl http://<hub>/api/fleet/catalogue
```

---

## 3) تشغيل الأسطول (خطوتين، بدون أي رفع ملفات)

### أ) موجة GitHub Actions
الريبو → **Settings → Secrets and variables → Actions → Variables**:

| الاسم | القيمة |
|---|---|
| `NOVA_HUB` | `ws://node.waifly.com:27214/api/local-agent/ws` |
| `FLEET_NODES` | `8` (لحد 19) |

بعد كده: **Actions → fleet-nodes → Run workflow**.
كل نود بيظهر فوراً هنا:

```bash
curl http://<hub>/api/fleet/capabilities
```

### ب) نود دائم على أي سيرفر مجاني (Waifly / Zeabur / Back4App)
أمر واحد بس، على السيرفر الجديد:

```bash
curl -fsSL http://<hub>/api/local-agent/download-agent | bash -s -- \
  --server ws://<hub>/api/local-agent/ws --id node-2
```

الـ API بيرجّعلك الأمر ده جاهز مع الأي دي بتاعك:

```bash
curl "http://<hub>/api/fleet/bootstrap?id=node-2"
```

---

## 4) الخدمات المجانية المضافة للدماغ (22 خدمة، بدون مفتاح)

| الفئة | أمثلة |
|---|---|
| DNS | Cloudflare DoH · Google DoH · RDAP |
| تهديدات | URLhaus · Shodan InternetDB · GreyNoise |
| ثغرات | NVD · CISA KEV · CIRCL · OSV · GitHub Advisory |
| ذكاء اصطناعي | Groq · Gemini · OpenRouter `:free` |
| شبكة | ip-api · ipinfo · BGPView |
| تخزين | GitHub Releases (توزيع `nova-24-7.zip`) |
| مراقبة | Healthchecks.io · UptimeRobot · cron-job.org |

القائمة الكاملة: `GET /api/fleet/catalogue` → حقل `services`.

---

## 5) إيه اللي الأسطول بيعمله فعلاً

`GET /api/fleet/capabilities` بيرجّع **النودات المتصلة بس**، ومعاها:

- عدد الأنوية والرام الحقيقية
- القدرات الموحّدة (`shell`, `files`, `pty`, `screenshot`, `processes`, `deep_profile` …)
- لو مفيش نود: بيقول «الأسطول = صفر» بصراحة

مفيش رقم مزيّف في الملف ده ولا في الـ API.

---

## 6) حدود لازم تتقال

- جلسة Actions 6 ساعات → النود بيخرج وموجة جديدة بتدخل. الأسطول **متجدد** مش دائم.
- Waifly بيعلّق النود لو غاب 3 أيام → `keepalive.yml` بيمنع ده.
- الـ hub (سيرفرك الأساسي) لازم يفضل شغّال — هو اللي بيوزّع الشغل.
- لو الـ hub اتعمل restart، النودات بترجع لوحدها (reconnect مع backoff).
