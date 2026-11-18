# TEST57 — apt جوه كالي كان بيفشل لأن الجست مش root

## العطل المقاس (من الصفحة)
```
dpkg: error: requested operation requires superuser privilege
E: Sub-process /usr/bin/dpkg returned an error code (2)
INSTALL_FAIL:ffuf
```

## السبب
غلاف العقدة كان `proot-static -R` من غير `-0`. dpkg يشوف uid مش 0 ويرفض. مجلدات TEST53 كانت موجودة، والخطأ اتغيّر من «directory missing» لـ «superuser privilege».

## الإصلاح
كل تشغيل للجست بقى بنفس أعلام `lib/ops/proot.ts`: `-R -w /root -0 -b /dev -b /proc -b /sys`.
ده يشمل طرفية الصفحة، تثبيت أي حزمة، سطح المكتب، `kali_run`، وموجة العقد.

الصفحة تعرض uid المقاس، وتقبل اسم أي حزمة (من غير مسافة) مش بس اللي في الكتالوج.

## اللي لسه مش متقاس حي
الهَب الشغّال على nova.waifly.com لسه بيبني الأمر القديم لحد ما يسحب الباندل الجديد. بعد التحديث: `GET /api/kali-env/identity` لازم يرجّع `root: true`، وبعدها تثبيت `ffuf` يرجّع `INSTALL_OK`.
