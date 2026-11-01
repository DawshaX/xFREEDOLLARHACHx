# المجلس — NOVA Council (multi-model deliberation)

> **باختصار:** نوفا مش بتسأل نموذج واحد. بتسأل **كل النماذج المتاحة** نفس السؤال في نفس
> الوقت، وبعدين **نموذج مختلف** يحكم بينهم ويطلع إجابة واحدة + يقولك فين اختلفوا.

---

## ١. ليه ده أذكى من نموذج واحد؟

| نموذج واحد | المجلس |
|---|---|
| إجابة واحدة، ثقة واحدة | إجابات متعددة، **درجة اتفاق** محسوبة |
| لو غلط، مش هتعرف | الاختلاف بيظهر كإشارة |
| بيقيّم نفسه | **نموذج تاني** هو اللي بيحكم (مش بيصحّح لنفسه) |
| سريع | أبطأ شوية — بس للأسئلة اللي الغلط فيها مكلف |

النتيجة اللي بتتخزن: `agreement` من 0 لـ 1 + تصنيف عربي (متوافقون / اختلاف جزئي / اختلاف كبير).

---

## ٢. المفاتيح المجانية (بدون كارت خالص)

سجّل في واحد أو أكتر، وحط المفتاح في **Environment / Variables** في لوحة الاستضافة:

| المزوّد | المتغير | من فين | ملاحظات |
|---|---|---|---|
| **Groq** | `GROQ_API_KEY` | console.groq.com | الأسرع (LPU) — ابدأ بيه |
| **Google Gemini** | `GEMINI_API_KEY` | aistudio.google.com | حصة مجانية كبيرة |
| **Cerebras** | `CEREBRAS_API_KEY` | cloud.cerebras.ai | سريع جدًا |
| **OpenRouter** | `OPENROUTER_API_KEY` | openrouter.ai/keys | نماذج `:free` كتير |
| **GitHub Models** | `GITHUB_MODELS_TOKEN` | github.com/settings/tokens | مجاني بحساب GitHub — مش محتاج حساب جديد |
| **Mistral** | `MISTRAL_API_KEY` | console.mistral.ai | free tier |
| **Together** | `TOGETHER_API_KEY` | api.together.xyz | free models |
| **Ollama** | — | محلي | مجاني تمامًا لو عندك جهاز |

**بمفتاح واحد** = صوت واحد (شغّال، بس مفيش تصويت).
**بمفتاحين** = تصويت + حكم متبادل ✅
**بتلاتة** = مجلس كامل ✅✅

---

## ٣. الـEndpoints

```bash
# مين في المجلس الآن؟
curl http://HOST/api/nova-core/council

# اسأل المجلس كله (الأبطأ والأدق)
curl -X POST http://HOST/api/nova-core/council \
  -H 'content-type: application/json' \
  -d '{"message":"إيه أخطر ثغرة في هذا الـ stack؟","members":3}'

# أول نموذج يرد (الأسرع — للأسئلة البسيطة)
curl -X POST http://HOST/api/nova-core/fast \
  -H 'content-type: application/json' -d '{"message":"قول تمام"}'

# الشات العادي مع وضع المجلس
curl -N -X POST http://HOST/api/nova-core/chat \
  -H 'content-type: application/json' -d '{"message":"...","council":true}'
```

### شكل الرد
```json
{
  "ok": true,
  "agreement": 0.83,
  "agreementLabel": "متوافقون",
  "judge": { "provider": "groq", "model": "llama-3.3-70b-versatile" },
  "members": [
    { "provider": "groq",     "ok": true,  "ms": 18 },
    { "provider": "cerebras", "ok": true,  "ms": 17 },
    { "provider": "ollama",   "ok": false, "ms": 11, "error": "ollama HTTP ..." }
  ],
  "disagreements": ["الأول لم يذكر خطوة التحقق العملي"],
  "answer": "## الحكم ... ## الإجابة النهائية ...",
  "ms": 31
}
```

---

## ٤. إعدادات اختيارية

| المتغير | الافتراضي | الوظيفة |
|---|---|---|
| `NOVA_COUNCIL_MEMBERS` | `3` | عدد النماذج اللي بتتسأل |
| `NOVA_COUNCIL_TIMEOUT_MS` | `30000` | أقصى وقت لكل نموذج |
| `<PROVIDER>_BASE_URL` | — | وجّه المزوّد لعنوان تاني (بروكسي/بوابة/جهاز في الأسطول) |
| `<PROVIDER>_MODEL` | — | غيّر الموديل |

---

## ٥. الحدود — بصراحة

- **مش هنقول إن البرنامج «بيطلع زيرو داي».** مفيش نموذج لغوي بيعمل كده.
  الزيرو داي بيتثبت بـ**دليل من تنفيذ حقيقي** (recon، تحليل فرق، crash، إعادة إنتاج).
- المجلس بيزوّد **جودة التفكير** ويقلل الهبد، وبيقولك **فين تشك**.
  الأداة هي اللي بتثبت — والدليل هو اللي بيتكتب في التقرير.
- لو النماذج اختلفت، **مش هنخبي الاختلاف**: نوفا بتقوله وبتحدد نقطة التحقق.
- مع صفر مفاتيح: المجلس بيقول الحقيقة (`503` + إزاي تحط مفتاح)، ومش بيألّف إجابة.
