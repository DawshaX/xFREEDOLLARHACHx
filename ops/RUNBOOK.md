# NOVA Runbook — عطب طابور GitHub Actions (الزومبي) وفكّه

> مكتوب بعد عطب حقيقي عديناه يوم 2026-11-16→17. الهدف: أي حد (أو أي إصدار جاي من
> الوكيل) يوصل لنفس التشخيص وينفذ نفس الفكس في دقايق، مش ساعات.

## العطبة

**العلم:** من ~22:18Z مافيش أي workflow في الrepo بيبدأ تنفيذ فعلي — كل الruns
`queued`/`pending` لساعات رغم إن githubstatus بيقول Actions operational.

**السبب الجذري (المقاس على موجة 2026-11-16 21:43:11Z):**

- الrepo مجاني → حد **20 concurrent jobs**.
- موجة `fleet-nodes` قبضت 20 jobs كلها (19 node jobs + prepare).
- الjobs دي خلصت خطواتها **فعليًا** (آخر خطوة `Complete job` خلصت في 22:41–23:11)
  بس ما اتسجلتش `completed` في الAPI — رنرز مقفولة على jobs ميتة → **زومبي**.
- النتيجة: كل مقاعد الحد الـ20 محجوزة، فأي run جديد بيقعد في الطابور للأبد
  (watchdog، Pages، bundle، fleet جديدة — كلها معسكرين).

**ليه ما نقدرش نلغيها يدويًا:** الGitHub app المتصل مالوش `actions:write` →
`POST /actions/runs/{id}/cancel` بيرجّع 403 `Resource not accessible by
integration`. و`fleet-nodes` نفسه `cancel-in-progress: false` فحتى run جديد في
نفس الgroup ما بقتلش القديم.

## التشخيص في 5 خطوات

```bash
# 1) مين في الطابور ومين شغال فعلا؟
gh api "repos/DawshaX/xFREEDOLLARHACHx/actions/runs?per_page=30" \
  --jq '.workflow_runs[] | select(.status != "completed") |
        "\(.id) \(.name) \(.status) created:\(.created_at)"'

# 2) الjobs اللي شاكية إنها شغالة — هل آخر خطوة اتكملت من قريب؟
gh api "repos/DawshaX/xFREEDOLLARHACHx/actions/runs/<RUN>/jobs?per_page=100" \
  --jq '.jobs[] | select(.status != "completed") |
        "\( .id ) | last-step: \( ([.steps[] | .completed_at] |
        map(select(. != null)) | sort | last // "none") )"'

# 3) لو آخر خطوة اتكملت من ساعات والjob لسه in_progress → زومبي مؤكد.

# 4) جرّب الإلغاء (غالبًا 403 مع الintegration، بس جرّبها دايمًا):
gh api -X POST "repos/DawshaX/xFREEDOLLARHACHx/actions/runs/<RUN>/cancel"

# 5) اتأكد من وقت الموت الطبيعي: timeout-minutes بتاع الjob (350د في fleet-nodes)
```

## الفكس

1. **جرّب cancel** (لو اشتغل — خلاص، الطابور يفور فورًا).
2. **لو 403:** استنى الموت الطبيعي — GitHub بيفصل الرنرز الجمدة لوحدها (لاحظنا
   الموجات السابقة بتموت بعد 2.5–4 ساعات، وبعدها الطابور بيفور **فورًا**:
   watchdog بيسجل فحص جديد، Pages بينشر، الموجة الجديدة بتبني).
3. **الوقت الأقصى:** `started_at` لأول job + `timeout-minutes` بتاعه (fleet-nodes:
   350د). بعده غصب GitHub بيقطعه.
4. **بعد الفك:** اتأكد بالترتيب —
   - فحص الwatchdog سجّل في `state/waifly-deploy.json` بcommit جديد
     (`boot:<sha>`) والوقت محدث.
   - Pages اتنشرت (`success`).
   - `standalone-bundle` ببنى `nova-24-7.zip` على `release nova-portable`.

## الوقاية (منفذة)

- **TEST49:** `max-parallel: 12` في `fleet-nodes.yml` — موجة ما تمسكش أكتر من
  12 slot، فيفضل ~8 سلات فاضية دايمًا للفحوصات والنشر حتى لو موجة علقت.
- `timeout-minutes: 350` على node jobs (< ال6 ساعات) — حد صلب يضمن الموت النظيف.
- `permissions: {contents: read, actions: read}` — أقل صلاحية ممكنة.

## العلم اللي بيوهمك إنك قدام عطب تاني مش الزومبي

- githubstatus operational **لا** يعني repo سليم — العطب هنا repo-side.
- runs كتير `queued` **بمافيش أي** `in_progress` = الحد concurrent محجوز.
- autocommits ب `[skip ci]` مش هيشغلوا `standalone-bundle` — لو محتاج bundle
  جديد، لازم push حقيقي يلمس `artifacts/**` أو `ops/**` أو `state/**`.
