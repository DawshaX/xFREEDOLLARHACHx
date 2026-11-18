#!/bin/bash
# nova-kali-full-builder — TEST64e (host-side, crash-safe).
# proot-static بيقع signal 6 تحت الحمل الطويل (مقاس 10:33Z بعد 35 أداة) — فالحل:
# أداة واحدة = proot invocation واحد قصير فيه القنوات الثلاثة (apt → pip → جيت هوب).
# الكراش بيقتل أداة بس — والhost يعيد المحاولة ويكمل. مافيش موت للكل أبدًا.
# الاستدعاء: bash kali-rootfs-full-build.sh <rootfs-path>
# المدخلات: <rootfs>/root/nova-missing.tsv (tool TAB pkg) · <rootfs>/root/nova-verify.txt
# المخرجات: <rootfs>/root/nova-tools-report.json + stdout بOK:/FAIL: لكل أداة
set -u
R="${1:?rootfs path}"
P="$R/usr/local/bin/proot-static"
TSV="$R/root/nova-missing.tsv"
VERIFY="$R/root/nova-verify.txt"
REPORT="$R/root/nova-tools-report.json"
LOG="$R/root/nova-builder.log"
: > "$LOG"

prun() {  # prun "<guest-script>" — invocation قصير معزول
  "$P" -0 -R "$R" -w /root -b /dev -b /proc -b /sys /bin/sh -c "$1"
}

# ── خريطة جيت هوب (host-side) — أمر المالك: «دور عالجيت هوب ووصلو أون لاين» ──
gh_map() {  # $1=tool → "URL<TAB>DEST" (فاضي = مافيش)
  case "$1" in
    ligolo-ng)
      V=$(curl -sfL --max-time 30 "https://api.github.com/repos/sysdreamo/ligolo-ng/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
      [ -n "$V" ] && echo -e "https://github.com/sysdreamo/ligolo-ng/releases/download/$V/ligolo-ng_${V#v}_linux_amd64.tar.gz\t/usr/local/bin/ligolo-ng";;
    asnmap)
      V=$(curl -sfL --max-time 30 "https://api.github.com/repos/projectdiscovery/asnmap/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
      [ -n "$V" ] && echo -e "https://github.com/projectdiscovery/asnmap/releases/download/$V/asnmap_linux_amd64.zip\t/usr/local/bin/asnmap";;
    shuffledns)
      V=$(curl -sfL --max-time 30 "https://api.github.com/repos/projectdiscovery/shuffledns/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
      [ -n "$V" ] && echo -e "https://github.com/projectdiscovery/shuffledns/releases/download/$V/shuffledns_linux_amd64.zip\t/usr/local/bin/shuffledns";;
    dvcs-ripper) echo -e "GITCLONE:https://github.com/kost/dvcs-ripper\t/usr/local/bin/dvcs-ripper";;
    chisel)      echo -e "https://github.com/jpillora/chisel/releases/download/v1.10.1/chisel_1.10.1_linux_amd64.gz\t/usr/local/bin/chisel";;
    pspy)        echo -e "https://github.com/DominicBreuker/pspy/releases/download/v1.2.1/pspy64\t/usr/local/bin/pspy";;
    ligolo-ng)   echo -e "https://github.com/sysdreamo/ligolo-ng/releases/download/v0.8.2/ligolo-ng_linux_amd64.tar.gz\t/usr/local/bin/ligolo-ng";;
    pspy)        echo -e "https://github.com/DominicBreuker/pspy/releases/download/v1.2.1/pspy64\t/usr/local/bin/pspy";;
    grype)
      V=$(curl -sfL --max-time 30 "https://api.github.com/repos/anchore/grype/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
      [ -n "$V" ] && echo -e "https://github.com/anchore/grype/releases/download/$V/grype_${V}_linux_amd64.tar.gz\t/usr/local/bin/grype";;
    trivy)
      V=$(curl -sfL --max-time 30 "https://api.github.com/repos/aquasecurity/trivy/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
      [ -n "$V" ] && echo -e "https://github.com/aquasecurity/trivy/releases/download/$V/trivy_${V}_Linux-64bit.tar.gz\t/usr/local/bin/trivy";;
    phoneinfoga)
      V=$(curl -sfL --max-time 30 "https://api.github.com/repos/radsecurity/phoneinfoga/releases/latest" | grep -o '"tag_name": *"[^"]*"' | cut -d'"' -f4)
      [ -n "$V" ] && echo -e "https://github.com/radsecurity/phoneinfoga/releases/download/$V/phoneinfoga_Linux_x86_64.tar.gz\t/usr/local/bin/phoneinfoga";;
  esac
}

install_one() {  # $1=tool $2=pkg → يطبع CH:<channel> أو فاضي (كراش)
  local tool="$1" pkg="$2" spec url dest=""
  spec=$(gh_map "$tool"); url=""; [ -n "$spec" ] && { url="${spec%%$'\t'*}"; dest="${spec##*$'\t'}"; }
  local guest
  guest=$(cat <<GOSEOF
export DEBIAN_FRONTEND=noninteractive
TOOL='$tool'; PKG='$pkg'
have() { command -v "\$TOOL" >/dev/null 2>&1 && return 0; dpkg -s "\$PKG" 2>/dev/null | grep -q 'install ok installed' && return 0; pip3 show "\$PKG" >/dev/null 2>&1 && return 0; return 1; }
remedy() { [ -f /var/lib/dpkg/statoverride ] && : > /var/lib/dpkg/statoverride; rm -f /var/lib/dpkg/lock* /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null; dpkg --configure -a 2>/dev/null; for d in var/log/apt var/lib/dpkg/updates var/lib/dpkg/triggers/File var/lib/dpkg/triggers/Unincorporated var/lib/dpkg/alternatives var/cache/apt/archives/partial var/lib/apt/lists/partial var/lib/ucf/cache run/lock tmp var/tmp var/lib/sudo var/spool/mail; do mkdir -p "/\$d" 2>/dev/null; done; apt-get -f install -y >/dev/null 2>&1; }
have && { echo CH:already; exit 0; }
remedy
apt-get install -y -o Dpkg::Options::=--force-confnew "\$PKG" >/dev/null 2>&1 && have && { echo CH:apt; exit 0; }
remedy
pip3 install --break-system-packages -q "\$PKG" >/dev/null 2>&1 || pip3 install -q "\$PKG" >/dev/null 2>&1
have && { echo CH:pip; exit 0; }
URL='$url'; DEST='$dest'
if [ -n "\$URL" ]; then
  mkdir -p /usr/local/bin /tmp/ghdl
  curl -sfL --max-time 180 "\$URL" -o /tmp/ghdl/d && {
    case "\$URL" in *.tar.gz|*.tgz) tar -xzf /tmp/ghdl/d -C /tmp/ghdl;; *.gz) gunzip -c /tmp/ghdl/d > /tmp/ghdl/b;; *) cp /tmp/ghdl/d /tmp/ghdl/b;; esac
    B=\$(ls /tmp/ghdl/b 2>/dev/null || find /tmp/ghdl -type f | head -1)
    [ -n "\$B" ] && cp "\$B" "\$DEST" && chmod +x "\$DEST"
  }
fi
have && { echo CH:github; exit 0; }
echo CH:none
GOSEOF
)
  timeout 900 "$P" -0 -R "$R" -w /root -b /dev -b /proc -b /sys /bin/sh -c "$guest" 2>> "$LOG" | tail -1
}

ok=0; fail=""; n=0
# BOOTSTRAP أولًا: pip3 + jq — القنوات التانية بتاعتهم
for BT in python3-pip:python3-pip jq:jq; do
  T="${BT%%:*}"; K="${BT##*:}"
  CH=$(install_one "$T" "$K")
  [ -z "$CH" ] && CH=$(install_one "$T" "$K")
  case "$CH" in CH:*) ok=$((ok+1)); echo "OK:$T (${CH#CH:})";; *) fail="$fail $T"; echo "FAIL:$T";; esac
done
while IFS=$'\t' read -r tool pkg; do
  [ -z "${tool:-}" ] && continue
  [ "$pkg" = "-" ] && pkg="$tool"
  n=$((n+1))
  CH=$(install_one "$tool" "$pkg")
  # كراش proot (فاضي) أو فشل كامل → محاولة ثانية واحدة
  if [ -z "$CH" ] || [ "$CH" = "CH:none" ]; then
    sleep 2
    CH=$(install_one "$tool" "$pkg")
  fi
  case "$CH" in
    CH:already) ok=$((ok+1)); echo "OK:$tool (already)";;
    CH:apt)     ok=$((ok+1)); echo "OK:$tool (apt)";;
    CH:pip)     ok=$((ok+1)); echo "OK:$tool (pip)";;
    CH:github)  ok=$((ok+1)); echo "OK:$tool (github)";;
    *)          fail="$fail $tool"; echo "FAIL:$tool";;
  esac
done < "$TSV"

# التحقق النهائي: كل الكتالوج (القديم + الجديد) — invocation واحد (سريع)
VOUT=$(prun 'while read -r t; do [ -z "$t" ] && continue; command -v "$t" >/dev/null 2>&1 && echo "VOK:$t" || echo "VOVER:$t"; done < /root/nova-verify.txt' 2>> "$LOG")
[ -z "$VOUT" ] && VOUT=$(prun 'while read -r t; do [ -z "$t" ] && continue; command -v "$t" >/dev/null 2>&1 && echo "VOK:$t" || echo "VOVER:$t"; done < /root/nova-verify.txt' 2>> "$LOG")
VOK=$(echo "$VOUT" | grep -c "^VOK:" || true)
VOVER=$(echo "$VOUT" | grep "^VOVER:" | awk '{printf "%s ", $1}' || true)
VTOTAL=$(wc -l < "$VERIFY")

cat > "$REPORT" << EOF
{"installTotal": $n, "installedOk": $ok, "installFailed": "$fail", "verifyOk": $VOK, "verifyTotal": $VTOTAL, "verifyOverdue": "$VOVER", "builtAt": "$(date -u +%FT%TZ)"}
EOF
cat "$REPORT"
