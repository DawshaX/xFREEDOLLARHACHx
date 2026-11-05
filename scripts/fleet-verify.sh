#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fleet-verify.sh — «هل الماكينة دي شغالة فعلًا؟» بسؤال واحد.
#
#   bash scripts/fleet-verify.sh https://cybernova-nova.onrender.com
#   bash scripts/fleet-verify.sh <render> <waifly> <codespace>   # كذا ماكينة مرة واحدة
#
# بيستخدم curl + node بس (مفيش تثبيت)، وبيسأل نفس السؤال اللي المحرك بيسأله:
#   GET <base>/api/health   →  2xx = شغالة، أي حاجة تانية = مش شغالة.
#
# الفرق عن أي فحص تاني: بيقول *ليه* فشلت بالعربي بنفس صياغة المحرك، فلو الرقم
# مختلف عن اللي في «ماكينات نوفا» يبقى فيه مشكلة حقيقية في الشبكة مش في اللوحة.
#
# exit 0 = كل الماكينات اللي اتبعتت ردّت 2xx · exit 1 = فيه واحدة مش شغالة أو
# الاستخدام غلط.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

if [ "$#" -eq 0 ]; then
  sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
fi

ok=0
bad=0

for raw in "$@"; do
  base="${raw%/}"
  case "$base" in
    http://*|https://*) ;;
    *) base="https://$base" ;;
  esac
  url="$base/api/health"

  # -m 12: مهلة كافية لسيرفر مجاني بيصحى من النوم (cold start) ومسموح تخلص.
  body_file="$(mktemp)"
  # %{http_code} بيطبع 000 لو الاتصال نفسه فشل — مفيش داعي لـ || echo 000.
  code="$(curl -sS -m 12 -o "$body_file" -w '%{http_code}' "$url" 2>/dev/null)"
  [ -z "$code" ] && code=000
  curl_err="$(curl -sS -m 12 -o /dev/null "$url" 2>&1 >/dev/null | head -c 400)"

  if [ "$code" -ge 200 ] 2>/dev/null && [ "$code" -lt 300 ]; then
    ok=$((ok + 1))
    # الحمولة الحقيقية: نسخة المحرك + اللي بيعرفه. غياب أي حقل = محرك أقدم، منكذبش.
    summary="$(node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try{
          const j=JSON.parse(s);
          const bits=[];
          if(j.ok!==undefined) bits.push("ok="+j.ok);
          else if(j.status!==undefined) bits.push("status="+j.status);
          if(j.version||j.build) bits.push("v="+(j.version||j.build));
          if(j.mode) bits.push("mode="+j.mode);
          if(j.uptime!==undefined) bits.push("uptime="+Math.round(Number(j.uptime)||0)+"s");
          if(j.counts&&j.counts.cves!==undefined) bits.push("cves="+j.counts.cves);
          if(j.service) bits.push("svc="+j.service);
          console.log(bits.join(" · ")||"رد 2xx (من غير تفاصيل)");
        }catch(e){console.log("رد 2xx بس الجسم مش JSON")}
      });' < "$body_file" 2>/dev/null)"
    printf '✅ %-52s HTTP %s · %s\n' "$base" "$code" "${summary:-رد 2xx}"
  else
    bad=$((bad + 1))
    case "$code" in
      000)
        if printf '%s' "$curl_err" | grep -qi "resolve\|ENOTFOUND\|Name or service not known"; then
          why="النطاق مش موجود (DNS) — يبقى الاسم متكتبش غلط أو السيرفر لسه ما اتعملش"
        elif printf '%s' "$curl_err" | grep -qi "timed out\|timeout"; then
          why="مردّش في الوقت — يا إما نايم وبيصحى، يا إما الماكينة واقفة"
        elif printf '%s' "$curl_err" | grep -qi "certificate verify\|local issuer\|unable to get"; then
          why="مشكلة شهادة TLS — اتأكد من https والاسم"
        elif printf '%s' "$curl_err" | grep -qi "SSL\|TLS\|eof"; then
          # مصافحة TLS بتقطع كده لما الاتصال نفسه يتقفل قبل أي رد — مش عيب شهادة.
          why="الاتصال قِطع قبل المصافحة — منع شبكة أو البورت مقفول"
        elif printf '%s' "$curl_err" | grep -qi "refused\|Couldn.t connect\|Failed to connect"; then
          why="البورت مقفول — العملية مش سامعة على البورت ده"
        else
          why="مفيش وصول للشبكة من هنا"
        fi
        ;;
      404) why="المحرك رد 404 — السيرفر شغال بس المسار مش /api/health (غالبًا Root Directory غلط)" ;;
      401|403) why="محتاج تسجيل دخول — البورت لسه Private (Codespaces) أو فيه حماية" ;;
      502|503|504) why="بوابة الماكينة مردّتش — العملية واقعة أو لسه بتقوم" ;;
      *) why="رد غير متوقع" ;;
    esac
    printf '❌ %-52s HTTP %s · %s\n' "$base" "$code" "$why"
    if [ -n "$curl_err" ]; then
      printf '   ↳ %s\n' "$(printf '%s' "$curl_err" | tr '\n' ' ')"
    fi
  fi
  rm -f "$body_file"
done

echo
if [ "$bad" -eq 0 ]; then
  echo "🎯 $ok/$ok ماكينة شغالة — سجّلها في «ماكينات نوفا» واضغط «استخدمه»."
  exit 0
fi
echo "⚠️ $ok شغالة · $bad مش شغالة من $((ok + bad))."
echo "   ملاحظة: الفحص ده من جهازك. المحرك في السحابة ممكن يشوفها مختلفة —"
echo "   الحكم النهائي هو GET /api/fleet/servers على المحرك نفسه (probe.up)."
exit 1
