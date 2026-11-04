# آلة مجانية للبرنامج — أي واحدة تختار، وإزاي تخلّيها كلها

دي إجابة السؤال «أبدأ من فين في Fly» + الطريق المجاني اللي مش محتاج كارت.

## أول حاجة: الحقيقة عن الفلوس (مش تخمين)

| الحاجة | مجاني؟ | التفاصيل |
| -- | -- | -- |
| **Fly Machines** | ❌ | مفيش رصيد مجاني للمنظمات الجديدة. تجربة قصيرة، وبعدها `shared-cpu-1x / 1GB` ≈ **2–7 دولار شهريًا** لو سايبها شغالة 24/7 |
| **Fly Sprites** | ⚠️ جزئي | لينكس حقيقي + ملفات بتفضل + صحوة في ~300ms، و**مجاني وهو نايم**. السعر ~0.04–0.07 دولار لكل ساعة CPU، وفي رصيد تجربة **$30**. يعني شغل متقطع = عمليًا صفر |
| **GitHub Codespaces** | ✅ | **120 ساعة-نواة مجانًا شهريًا**، على حسابك في GitHub نفسه — مفيش كارت ولا تسجيل جديد |
| **GitHub Actions** | ✅ | 4 أنوية أوبونتو مجانًا للمستودعات العامة — ده اللي شغّال عندك أصلاً (الصيد، الكوربوس، المخ) |
| **Render Free** | ✅ | 750 ساعة شهريًا، بس **بينام بعد 15 دقيقة** وبلا قرص ثابت |
| **Oracle Always Free** | ✅ | 4 أنوية ARM + 24 جيجا مجانًا للأبد — بس محتاج **كارت للتحقق** (مش بيسحب) |

## فالاختيار

**لو هتختار حاجة واحدة دلوقتي → GitHub Codespaces.** لأنها مجانية بلا كارت، والآلة هي حسابك اللي موجود أصلاً، وفيها root وبتشغّل nuclei/httpx/katana الحقيقيين.

**لو عايز آلة بتفضل صاحية والمخ يشتغل عليها 24/7 → Fly Sprites** (مش Machines): بتنام لوحدها (يعني مجانية وهي نايمة) وبتصحى في نص ثانية، وفيها رصيد $30.

> Sprites مش بديل عن Codespaces في المهمة دي — هي أذكى للوكيل اللي بيعمل مهام متقطعة، ومكلفة لو سبتها صاحية. فمتخلطش: Codespaces = الكمبيوتر اللي بتشتغل عليه، Sprites = كمبيوتر الوكيل لما يبقى عنده مهام.

## 1) Codespaces — مجاني، دقيقة واحدة (مفضّل)

1. في GitHub: زرار **Code** الأخضر → تبويب **Codespaces** → **Create codespace on main**
2. استنى — الـ`devcontainer` بيشغّل `scripts/nova-machine-setup.sh` لوحده:
   deps + build المحرك + build اللوحة + تنزيل nuclei/httpx/katana/subfinder + توليد توكن
3. في تبويب **Ports** → بورت **8080** → **Visibility: Public** → انسخ الـhttps URL
4. افتح صفحة `nova-fleet` على Pages → «محطة نوفا» → الصق **الـURL** + **التوكن** من `.env.local`

بعدها صفحة الأسطول بتقرأ من الآلة دي مش من المتصفح: العقل اللغوي، الأسطول، محرك التنفيذ، البث `/api/ws` — كلهم حقيقيين.

> Codespaces بتقفل بعد 30 دقيقة خمول (قابل للتغيير من الإعدادات لـ4 ساعات). يعني «شغال 24/7» مش وعدها — لكنها **بتشتغل من غير ما تدفع**.

## 2) Fly Sprites — لو عايز آلة الوكيل

```bash
# من عندك، مرة واحدة
fly auth signup          # أو fly auth login
```

بعد ما تعمل Sprite من الصفحة اللي انت واقف عليها، جوّاه:

```bash
git clone https://github.com/DawshaX/xFREEDOLLARHACHx && cd xFREEDOLLARHACHx
./scripts/nova-machine-setup.sh
./scripts/nova-serve.sh --bg
curl -s localhost:8080/api/health
```

الـSprite بياخد URL عام من الشكل `https://<name>.sprites.app` وبيصحى أول ما تتصل بيه.

## 3) Fly Machines — لو دفعت

`fly.toml` موجود وجاهز في الجذر (`cybernova-nova`, `fra`, volume `nova_data`, health check على `/api/health`):

```bash
fly launch --copy-config --name cybernova-nova
fly volumes create nova_data --size 1 --region fra
fly deploy
fly secrets set NOVA_EXEC_TOKEN=$(openssl rand -hex 32)
```

## 4) Render — لو حابب Blueprint

`render.yaml` جاهز: Render → **New → Blueprint** → اختار الريبو → **Apply**.
بيولّد `NOVA_EXEC_TOKEN` تلقائي، وبينشر البانل والمحرك في نفس العملية.
الحقيقة الوحيدة اللي لازم تعرفها: **بينام بعد 15 دقيقة** — `keepalive.yml` بيصحّيه كل 10 دقايق، بس أول طلب بعد النوم بياخد ~30 ثانية.

## اللي بيتأكد إنه شغال

```bash
curl -s localhost:8080/api/health
# {"status":"ok","mode":"standalone","wsConnected":true,...}
```

لو `wsConnected` بقت `false`، يبقى البث مقفول — والباقي شغال عادي.
