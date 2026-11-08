# المضيفون المجانيون — آخر قياس آلي
> اتولّد من `scripts/free-host-survey.mjs` (شغّله workflow `free-host-survey.yml`).
> **مفيش رقم هنا مقس من غير ما يضرب الموقع نفسه.**
آخر قياس: `2026-11-08T17:54:23.266Z` · المصدر: `engine:http://127.0.0.1:8080` · بيردّ: **14/14**
«reachable» = موقع المورد بيردّ من المكان اللي اتقاس منه. مش ضمان تسجيل، ولا ضمان خدمة، ولا ضمان استمرارية.
| المورد | رام | دائم؟ | بطاقة | نود؟ | مسح نشط | القياس |
|---|---|---|---|---|---|---|
| GitHub نفسه (Pages + Actions + Releases) — القاعدة اللي مغنية عن السيرفر | 16 GB · 4 vCPU لكل job (ولحد 20 job مع بعض) | ❌ | ✅ بلا | ephemeral | ممنوع في شروطهم | ✓ 200 · 38ms |
| Waifly | 300 MB · 1 GB disk | ✅ | ✅ بلا | permanent | مش مذكور | ✓ 200 · 440ms |
| Render | 512 MB · 0.1 CPU | ⚠️ بينام | ✅ بلا | ephemeral | مش مذكور | ✓ 200 · 173ms |
| Zeabur | حسب الرصيد | ✅ | ✅ بلا | permanent | مش مذكور | ✓ 200 · 449ms |
| Back4App Containers | 256–512 MB | ✅ | ✅ بلا | permanent | مش مذكور | ✓ 200 · 626ms |
| SnapDeploy | 4 × 512 MB | ⚠️ بينام | ✅ بلا | ephemeral | مش مذكور | ✓ 200 · 462ms |
| Bonto | 512 MB | ⚠️ بينام | ✅ بلا | ephemeral | مش مذكور | ✓ 200 · 288ms |
| Oracle Cloud Always Free | 24 GB ARM · 4 vCPU | ✅ | ❌ مطلوب | permanent | ممنوع في شروطهم | ✓ 200 · 357ms |
| Koyeb / Northflank / Fly.io | — | ❌ | ❌ مطلوب | no | مش مذكور | ✓ 200 · 533ms |
| Cloudflare / Vercel / Netlify | 128 MB / request | ✅ | ✅ بلا | no | مش مذكور | ✓ 200 · 646ms |
| GratisVPS.net — VPS كامل بلا كارت | 2 GB · 2 vCPU KVM · NVMe | ✅ | ✅ بلا | permanent | ممنوع في شروطهم | ✓ 200 · 818ms |
| FreeVPS.edu.pl — KVM للطلاب والمطورين | KVM مستقل · Ryzen 9 · DDR5 ECC · NVMe | ✅ | ✅ بلا | permanent | مش مذكور | ✓ 200 · 808ms |
| Silly Development — الحاوية اللي مابتنامش | 256 MB · 25% core · 512 MB disk | ✅ | ✅ بلا | permanent | مش مذكور | ✓ 200 · 629ms |
| Azure for Students — $100 كرِدِت من غير كارت | حسب الاختيار (B1s = 1 GB · D-series أعلى) | ✅ | ✅ بلا | permanent | ممنوع في شروطهم | ✓ 200 · 539ms |
## أدق تفاصيل مقاسة (ادّعاء المورد + نتيجة القياس)
- **GitHub نفسه (Pages + Actions + Releases) — القاعدة اللي مغنية عن السيرفر** — `gh-actions`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 38ms
- **Waifly** — `waifly`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 440ms
- **Render** — `render`: الخطة المجانية لسه موجودة: 750 ساعة/شهر، بس الـbandwidth اتقصّف لـ5GB في أبريل 2026 وخدمة الويب المجانية بتنام بعد 15 دقيقة (صحوتها ~دقيقة). متحقق من شاشة New W · القياس: ردّ HTTP 200 في 173ms
- **Zeabur** — `zeabur`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 449ms
- **Back4App Containers** — `back4app`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 626ms
- **SnapDeploy** — `snapdeploy`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 462ms
- **Bonto** — `bonto`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 288ms
- **Oracle Cloud Always Free** — `oracle-always-free`: مقارنة مضيفين مجانية (نشر أكتوبر 2026) بتقول: Always Free Arm لحد 2 OCPU/12 جيجا أو اتنين AMD micro (1 جيجا) + 200 جيجا ديسك، بطاقة للائتمان وقت التسجيل، و«idle · القياس: ردّ HTTP 200 في 357ms
- **Koyeb / Northflank / Fly.io** — `koyeb-northflank-fly`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 533ms
- **Cloudflare / Vercel / Netlify** — `cloudflare-pages`: مفيش status2026 مسجل · القياس: ردّ HTTP 200 في 646ms
- **GratisVPS.net — VPS كامل بلا كارت** — `gratisvps`: صفحة أكتوبر 2026: تسجيل ببريد بس (مفيش كارت/PayPal/تليفون)، Ubuntu 24.04 / Debian 12 / AlmaLinux 9 أو Windows، 3 ريجيونز US/Frankfurt/Singapore، و«No fixed end  · القياس: ردّ HTTP 200 في 818ms
- **FreeVPS.edu.pl — KVM للطلاب والمطورين** — `freevps-edu`: الموقع (2026): الطالب بريد `.edu` بيوافق فورًا، والمطور بمراجعة GitHub/Portfolio — يعني حسابك على GitHub هو مفتاحك، ومفيش بطاقة · القياس: ردّ HTTP 200 في 808ms
- **Silly Development — الحاوية اللي مابتنامش** — `sillydev`: صفحتهم (نوفمبر 2026): بلا كارت، بلا تجديد، Node/Python/Bun، قواعد بيانات مجانية. الاستثناء الوحيد: سيرفر مااتستخدموش في أول 7 أيام بيتشيل بعد إيميل تحذير. Trust · القياس: ردّ HTTP 200 في 629ms
- **Azure for Students — $100 كرِدِت من غير كارت** — `azure-students`: مقارنات 2026 بتسمّيه الاستثناء الحقيقي على قاعدة «كل كرِدِت محتاج بطاقة»: التحقق ببريد جامعة بس، و«Zero credit or debit card details required» مع root وIPv4 مخص · القياس: ردّ HTTP 200 في 539ms
## إزاي تعيد القياس
```bash
# من غير أي حاجة (قياس مباشر من الشبكة اللي أنت فيها)
node scripts/free-host-survey.mjs
# أو اسأل محرك شغال (نفس كود القياس بتاع الإنتاج)
node scripts/free-host-survey.mjs --url http://127.0.0.1:8080
# أو الـhub الحي
NOVA_HUB_URL=https://<hub> node scripts/free-host-survey.mjs
```
