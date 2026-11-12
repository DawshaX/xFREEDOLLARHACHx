# قرايات NOVA — إيه المدمج، وإيه اللي على التخزين المجاني

القرايات دي مش رفاهية: `ffuf` و`gobuster` و`dalfox` بلا معنى من غير `-w`، والحاوية
المجانية مافيهاش SecLists ومافيهاش root يثبّته. فالملفات الصغيرة جوه المستودع (بتروح
مع الحزمة المحمولة)، والملف الكبير على **تخزين مجاني عام** وبينجلب بطلب.

| الملف | السطور | الحجم | فين |
|---|---|---|---|
| `nova-paths.txt` | 215 | 1.9KB | في الحزمة (الافتراضي السريع) |
| `paths-medium.txt` | 7,207 | 78KB | في الحزمة (`NOVA_WORDLIST_SIZE=medium`) |
| `params-burp.txt` | 6,453 | 54KB | في الحزمة (بارامترات) |
| `nova-paths-xl.txt` | 60,000 | 592KB | في الحزمة (`xl` / `large`) |
| `nova-vuln-xl.txt` | 7,746 | 190KB | في الحزمة (`vuln`) — نسخ احتياطية/لوحات/إعدادات |
| `nova-params-xl.txt` | 6,115 | 51KB | في الحزمة (`params-xl`) |
| `nova-subdomains-xl.txt` | 150,000 | 1.9MB | **مش في الحزمة** — على Drive/Dropbox، بيجيبه `POST /api/ops/wordlists/fetch` |

## ليه ملف واحد بره؟ (مش ذوق — قياس)
`GET /api/ops/tools → resources` على المكنة الحيّة 2026-11-08T01:42Z قال: رام 460MB
والسلوت 1024MB قرص، والحزمة نفسها بيرفّعها الـupdater كل ما ينشر بناء. فـ1.9MB لكل
حزمة = ثمن بيتدفع في كل تحديث على مكنة ضعيفة. المستودع (جيت هاب) «لا محدود» فعلًا،
وده بالظبط اللي بنستخدمه: الملفات اللي لزم وجودها بتبقى جوه الحزمة، واللي بيتطلب
بطلب بيقع على Drive/Dropbox.

## الأمان: المرآة ناقل، مش مصدر ثقة
`free-store.json` فيه `sha256` وحجم كل ملف. أي بايت بيجي من بره لازم يطابق البصمة
قبل ما يُستعمل — وده بيمنع إن أي حد يقدر يبلّع المكنة قايمة مسمومة (قايمة متغيّرة =
نتائج غلط في صيد حقيقي). `scripts/test-free-store.mjs** بيختبر الرفض ده فعليًا، و
`.github/workflows/free-store.yml` بيعيد قياس المرآات من شبكة ليها نت كل أربعاء
(ولكل دفع تعدّل الملفات دي).

## توليد القرايات تاني (من مصدر مجاني عام)
```sh
curl -sL https://codeload.github.com/danielmiessler/SecLists/tar.gz/refs/heads/master -o /tmp/seclists.tgz
mkdir -p /tmp && tar -xzf /tmp/seclists.tgz -C /tmp
node scripts/build-freelists.mjs --from /tmp/SecLists-master --repo \
  --src-sha "$(sha256sum /tmp/seclists.tgz | cut -d' ' -f1)"
node scripts/check-free-store.mjs          # البصمات من القرص
node scripts/check-free-store.mjs --live   # المرآات (محتاج نت)
```
المصدر المستخدم النهارده: `danielmiessler/SecLists@master` · تاربول
`sha256 681f6da2ac3420d84134efd5a920b49039b9404d2d9cf71e811c001885fb2ad1` · 711,088,194 بايت.
القرايات بتتلمّ وتتنضّف (ASCII بس، بدون أسطر فاضية، بدون تكرار) — والسقف في
`scripts/build-freelists.mjs` مش في ملف نصّي اتكتب باليد.
