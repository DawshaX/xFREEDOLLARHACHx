#!/bin/bash
# nova-kali-full-builder — TEST64 (أمر المالك 09:45Z): «كل الادوات كاملة من الاخر
# + دور عالجيت هوب ووصلو اون لاين».
# بيشتغل جوه proot guest (كالي حقيقية 2113 حزمة) على الCI — نفس بيئة العقدة بالحرف.
# المدخل:  /tmp/nova-missing.tsv   (tool [TAB] pkg-override أو -)
#          /tmp/nova-verify.txt   (كل أسماء الأدوات في الكتالوج — التحقق النهائي)
# المخرج:  /tmp/nova-tools-report.json  (ok / failed / per-tool)
# القنوات لكل أداة: apt → pip → تحميل من جيت هوب (release) — بالترتيب.
set -u
export DEBIAN_FRONTEND=noninteractive
REPORT=/root/nova-tools-report.json
LOG=/root/nova-builder.log
: > "$LOG"

# ── إصلاح dpkg الجذري (مقاس 10:19Z: «unknown system user 'redis' in statoverride») ──
# الجست بيتفك من tar فstatoverride بيفضل فيه يوزرز مش موجودين → كل apt install بيموت.
# الحل القياسي: تفريغ statoverride (الـsuid overrides بتتصلح لوحدها في proot -0).
remedy_dpkg() {
  echo "[remedy] dpkg repair: statoverride-truncate + dirs + configure -a + -f install" >> "$LOG"
  if [ -f /var/lib/dpkg/statoverride ]; then
    cp /var/lib/dpkg/statoverride /var/lib/dpkg/statoverride.bak 2>/dev/null || true
    : > /var/lib/dpkg/statoverride
  fi
  touch /var/lib/dpkg/arch 2>/dev/null
  for d in var/log/apt var/lib/dpkg/updates var/lib/dpkg/triggers/File var/lib/dpkg/triggers/Unincorporated \
           var/lib/dpkg/alternatives var/cache/apt/archives/partial var/lib/apt/lists/partial \
           var/lib/ucf/cache run/lock tmp var/tmp var/lib/sudo var/spool/mail; do
    mkdir -p "/$d" 2>/dev/null
  done
  dpkg --configure -a >> "$LOG" 2>&1 || true
  apt-get -f install -y -qq >> "$LOG" 2>&1 || true
}

echo "[*] apt-get update (full)" >> "$LOG"
apt-get update >> "$LOG" 2>&1 || echo "[!] apt-get update رجع خطأ — هنشوف في التثبيت" >> "$LOG"
remedy_dpkg

# ── قناة جيت هوب: tool → (repo, asset-template ب{ver}, dest) ────────────────
gh_fetch() {
  local tool="$1" repo="$2" tpl="$3" dest="$4"
  local ver url
  ver=$(curl -sfL --max-time 30 "https://api.github.com/repos/$repo/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
  [ -z "$ver" ] && return 1
  url=$(echo "$tpl" | sed "s/{ver}/$ver/g")
  mkdir -p "/usr/local/bin" "/tmp/ghdl.$$"
  case "$url" in
    *.gz|*.tgz|*.tar.gz)
      curl -sfL --max-time 120 "$url" -o "/tmp/ghdl.$$/d" || { rm -rf "/tmp/ghdl.$$"; return 1; }
      case "$url" in
        *.tar.gz|*.tgz) tar -xzf "/tmp/ghdl.$$/d" -C "/tmp/ghdl.$$" 2>/dev/null;;
        *.gz) gunzip -c "/tmp/ghdl.$$/d" > "/tmp/ghdl.$$/d.out"; mv "/tmp/ghdl.$$/d.out" "/tmp/ghdl.$$/d";;
      esac
      local bin
      bin=$(find "/tmp/ghdl.$$" -type f | head -1)
      [ -n "$bin" ] && cp "$bin" "$dest" && chmod +x "$dest"
      rm -rf "/tmp/ghdl.$$"; command -v "$tool" >/dev/null 2>&1 || [ -x "$dest" ];;
    *)  curl -sfL --max-time 120 "$url" -o "$dest" && chmod +x "$dest" && command -v "$tool" >/dev/null 2>&1;;
  esac
}

# ── خريطة جيت هوب (دور عالجيت هوب ووصّل أونلاين — أمر المالك) ────────────────
gh_install() {
  local tool="$1"
  case "$tool" in
    chisel)      gh_fetch chisel "jpillora/chisel"        "https://github.com/jpillora/chisel/releases/download/{ver}/chisel_1.10.1_linux_amd64.gz" "/usr/local/bin/chisel";;
    ligolo-ng)   gh_fetch ligolo-ng "sysdreamo/ligolo-ng"  "https://github.com/sysdreamo/ligolo-ng/releases/download/{ver}/ligolo-ng_linux_amd64.tar.gz" "/usr/local/bin/ligolo-ng";;
    grype)       gh_fetch grype "anchore/grype"            "https://github.com/anchore/grype/releases/download/{ver}/grype_{ver}_linux_amd64.tar.gz" "/usr/local/bin/grype";;
    trivy)       gh_fetch trivy "aquasecurity/trivy"       "https://github.com/aquasecurity/trivy/releases/download/{ver}/trivy_{ver}_Linux-64bit.tar.gz" "/usr/local/bin/trivy";;
    phoneinfoga) gh_fetch phoneinfoga "radsecurity/phoneinfoga" "https://github.com/radsecurity/phoneinfoga/releases/download/{ver}/phoneinfoga_Linux_x86_64.tar.gz" "/usr/local/bin/phoneinfoga";;
    pspy)        gh_fetch pspy "DominicBreuker/pspy"       "https://github.com/DominicBreuker/pspy/releases/download/{ver}/pspy64" "/usr/local/bin/pspy";;
    *) return 1;;
  esac
}

# ── التثبيت: كل أداة = apt → pip → جيت هوب، مع فكس dpkg بين المحاولات ───────
ok=0; fail=""
declare -A DETAIL
while IFS=$'\t' read -r tool pkg; do
  [ -z "${tool:-}" ] && continue
  [ "$pkg" = "-" ] && pkg="$tool"
  st=""
  # 1) apt (الحزم الجاهزة من كالي)
  if DEBIAN_FRONTEND=noninteractive apt-get install -y -qq -o Dpkg::Options::="--force-confnew" "$pkg" >> "$LOG" 2>&1; then
    st="apt"
  else
    echo "[retry] $pkg apt فشلت — remedy + محاولة pip" >> "$LOG"
    remedy_dpkg
    # 2) pip (أدوات بايثون)
    if pip3 install --break-system-packages -q "$pkg" >> "$LOG" 2>&1 || pip3 install -q "$pkg" >> "$LOG" 2>&1; then
      st="pip"
    else
      # 3) جيت هوب (releases — أمر المالك)
      if gh_install "$tool"; then st="github"; fi
    fi
  fi
  # تحقق نهائي للأداة نفسها
  if command -v "$tool" >/dev/null 2>&1 || dpkg -s "$pkg" 2>/dev/null | grep -q "install ok installed" || pip3 show "${pkg%%=*}" 2>/dev/null | grep -q "^Name:"; then
    ok=$((ok+1)); DETAIL[$tool]="OK($st)"
    echo "OK:$tool ($st)"
  else
    fail="$fail $tool"; DETAIL[$tool]="FAIL"
    echo "FAIL:$tool"
  fi
done < /root/nova-missing.tsv

# ── التحقق النهائي: كل الكتالوج (الموجودة قبل + المثبتة) لازم تفضل موجودة ──
allok=0; allover=""
while read -r t; do
  [ -z "${t:-}" ] && continue
  if command -v "$t" >/dev/null 2>&1; then allok=$((allok+1)); else allover="$allover $t"; fi
done < /root/nova-verify.txt

cat > "$REPORT" << EOF
{"installedOk": $ok, "installFailed": "$fail", "verifyOk": $allok, "verifyTotal": $(wc -l < /tmp/nova-verify.txt), "verifyOverdue": "$allover", "builtAt": "$(date -u +%FT%TZ)"}
EOF
echo "[✓] التقرير: $REPORT"
cat "$REPORT"
