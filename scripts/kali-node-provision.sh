#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TEST93y — تزويد العقدة الذاتي: كل الكتالوج من kali-store قبل الانضمام للهَب.
#
# الدايرة المقفولة اللي اتكسرت: كل موجة عقد جديدة = rootfs نضيف من غير أدوات
# → تمريرات يدوية من الهَب بتسرق سلات الموجات → الموجات بتجوع → الأسطول يموت.
# الحل: العقدة بتثبت أدواتها بنفسها هنا (dpkg/tar/pip/clone عبر proot على
# الـrunner مباشرة — أسرع وأرخص من دورة الهَب) وبتنضم مُحمّلة بالكامل.
#
# يعمل على الrunner (مش جوه الجست) — العمليات الملفية مباشرة على $R والـdpkg/
# الـpip/الclone جوه proot. مافيش فشل قاتل: كل خطأ تحذير والنقص يظهر في القياس.
# ─────────────────────────────────────────────────────────────────────────────
set +e
R="$HOME/kali-rootfs/rootfs"
P="$R/usr/local/bin/proot-static"
if [ ! -x "$P" ]; then echo "::warning::لا proot — التزويد متخطى"; exit 0; fi

GUEST() { "$P" -0 -R "$R" -w /root -b /dev -b /proc -b /sys "$@"; }

# ── البيئة: DNS + مجلدات dpkg + statoverride ──
printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "$R/etc/resolv.conf"
GUEST /bin/sh -c 'for d in var/log/apt var/lib/dpkg/updates var/lib/dpkg/triggers/File var/lib/dpkg/triggers/Unincorporated var/lib/dpkg/alternatives var/cache/apt/archives/partial var/lib/apt/lists/partial var/lib/ucf/cache run/lock tmp var/tmp var/lib/sudo var/spool/mail; do mkdir -p "/$d" 2>/dev/null; done; sed -i "/redis/d" /var/lib/dpkg/statoverride 2>/dev/null; true'

# ── المخزن ──
mkdir -p /tmp/store && cd /tmp/store || exit 0
echo "## provision $(date -u +%FT%TZ)" > /tmp/provision.log
gh release download kali-store -R "$GITHUB_REPOSITORY" --clobber >> /tmp/provision.log 2>&1 || echo "::warning::store download ناقص"
ls -la /tmp/store | head -50 >> /tmp/provision.log

# ── 1) حزم debs لكل أداة (23) ──
DEBS="ettercap exiftool steghide arp-scan cherrytree recordmydesktop wkhtmltopdf maskprocessor rainbowcrack redis elfutils ltrace strace zsh vim aria2 sidguesser netexec crackmapexec pandoc legion fern casefile"
OKD=0; MISSD=""
for b in $DEBS; do
  [ -f "$b-debs.tar.gz" ] || { MISSD="$MISSD $b"; continue; }
  rm -rf "/tmp/dl-$b"; mkdir -p "/tmp/dl-$b"
  tar xzf "$b-debs.tar.gz" -C "/tmp/dl-$b" 2>/dev/null
  if [ "$b" = "maskprocessor" ]; then
    # postinst بيحاول systemctl → proot crash — استخراج يدوي (مقاس ×6)
    GUEST /bin/sh -c "for d in /tmp/dl-$b/*.deb; do dpkg-deb -x \"\$d\" /tmp/mpx 2>/dev/null; done; find /tmp/mpx -type f \\( -name mp -o -name maskprocessor \\) -exec cp {} /usr/local/bin/ \\; 2>/dev/null; chmod +x /usr/local/bin/mp 2>/dev/null; true"
  else
    GUEST /bin/sh -c "cd /tmp/dl-$b && dpkg -i --force-all *.deb 2>&1 | tail -1; dpkg --configure -a 2>&1 | tail -1" >> /tmp/provision.log 2>&1
  fi
  OKD=$((OKD+1))
done
echo "debs: $OKD/23${MISSD:+ — miss:$MISSD}"

# ── 2) الثقيلة: parts + tarballs (فك ملفي مباشر على $R — أسرع من proot) ──
for big in ghidra.tar.gz retdec.tar.gz python3-pip.tar.gz; do
  [ -f "$big" ] && tar xzf "$big" -C "$R" 2>/dev/null && echo "OK:big $big"
done
for big in powershell-empire.tar.gz faraday.tar.gz dradis.tar.gz; do
  if ls "$big".part_* >/dev/null 2>&1; then
    cat "$big".part_* | tar xz -C "$R" 2>/dev/null && echo "OK:big $big (parts)"
  elif [ -f "$big" ]; then
    tar xzf "$big" -C "$R" 2>/dev/null && echo "OK:big $big"
  fi
done

# ── 3) binaries من releases (روابط مخبوزة — فك ملفي مباشر) ──
BINS="
amass|https://github.com/owasp-amass/amass/releases/download/v5.1.3/amass_linux_amd64.tar.gz|tgz
subfinder|https://github.com/projectdiscovery/subfinder/releases/download/v2.17.0/subfinder_2.17.0_linux_amd64.zip|zip
naabu|https://github.com/projectdiscovery/naabu/releases/download/v2.7.0/naabu_2.7.0_linux_amd64.zip|zip
dnsx|https://github.com/projectdiscovery/dnsx/releases/download/v1.3.1/dnsx_1.3.1_linux_amd64.zip|zip
httpx|https://github.com/projectdiscovery/httpx/releases/download/v1.12.0/httpx_1.12.0_linux_amd64.zip|zip
katana|https://github.com/projectdiscovery/katana/releases/download/v1.8.0/katana_1.8.0_linux_amd64.zip|zip
cariddi|https://github.com/edoardottt/cariddi/releases/download/v1.4.6/cariddi_1.4.6_linux_amd64.zip|zip
bettercap|https://github.com/bettercap/bettercap/releases/download/v2.41.7/bettercap_linux_amd64.zip|zip
asnmap|https://github.com/projectdiscovery/asnmap/releases/download/v1.2.0/asnmap_1.2.0_linux_amd64.zip|zip
shuffledns|https://github.com/projectdiscovery/shuffledns/releases/download/v1.2.1/shuffledns_1.2.1_linux_amd64.zip|zip
chisel|https://github.com/jpillora/chisel/releases/download/v1.12.0/chisel_1.12.0_linux_amd64.gz|gz
mongosh|https://github.com/mongodb-js/mongosh/releases/download/v2.14.2/mongosh-2.14.2-linux-x64.tgz|tgz
grype|https://github.com/anchore/grype/releases/download/v0.122.1/grype_0.122.1_linux_amd64.tar.gz|tgz
syft|https://github.com/anchore/syft/releases/download/v1.57.2/syft_1.57.2_linux_amd64.tar.gz|tgz
trufflehog|https://github.com/trufflesecurity/trufflehog/releases/download/v3.99.9/trufflehog_3.99.9_linux_amd64.tar.gz|tgz
dockle|https://github.com/goodwithtech/dockle/releases/download/v0.4.15/dockle_0.4.15_Linux-64bit.tar.gz|tgz
"
OKB=0; MISSB=""
mkdir -p "$R/usr/local/bin"
for spec in $BINS; do
  name="${spec%%|*}"; rest="${spec#*|}"; url="${rest%%|*}"; kind="${rest##*|}"
  curl -sfL -m 240 "$url" -o /tmp/pkg.bin || { MISSB="$MISSB $name"; continue; }
  rm -rf /tmp/pkgx && mkdir -p /tmp/pkgx
  case "$kind" in
    tgz) tar xzf /tmp/pkg.bin -C /tmp/pkgx 2>/dev/null ;;
    zip) unzip -qo /tmp/pkg.bin -d /tmp/pkgx 2>/dev/null ;;
    gz)  cp /tmp/pkg.bin /tmp/pkgx/$name.gz && gunzip -f /tmp/pkgx/$name.gz 2>/dev/null ;;
  esac
  BIN="$(find /tmp/pkgx -type f -name "$name*" 2>/dev/null | head -1)"
  [ -z "$BIN" ] && BIN="$(find /tmp/pkgx -type f -perm -u+x 2>/dev/null | head -1)"
  if [ -n "$BIN" ]; then cp "$BIN" "$R/usr/local/bin/$name" && chmod +x "$R/usr/local/bin/$name" && OKB=$((OKB+1)); else MISSB="$MISSB $name"; fi
done
# subzy + gotator من المخزن (بناء golang مرفوع)
for gb in subzy gotator; do
  if [ -f "$gb.tar.gz" ]; then tar xzf "$gb.tar.gz" -C "$R" 2>/dev/null && OKB=$((OKB+1)); else MISSB="$MISSB $gb"; fi
done
echo "binaries: $OKB/18${MISSB:+ — miss:$MISSB}"

# ── 4) pip (جوه الجست) ──
OKP=0; MISSP=""
PIPS="maigret h8mail prowler scoutsuite pacu certipy-ad bloodhound sherlock-project sublist3r ssh-audit semgrep volatility3"
GUEST /bin/sh -c "PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --ignore-installed $PIPS 2>&1 | tail -2 || python3 -m pip install --break-system-packages -q --ignore-installed $PIPS 2>&1 | tail -2" >> /tmp/provision.log 2>&1
for p in maigret:h8mail prowler:scout pacu:certipy ssh-audit:semgrep sherlock:sublist3r vol:vol; do :; done
for pair in maigret:maigret h8mail:h8mail prowler:prowler scoutsuite:scout pacu:pacu certipy:certipy-ad "bloodhound-python:bloodhound-python" "ssh-audit:ssh-audit" "semgrep:semgrep" "sherlock:sherlock" "sublist3r:sublist3r" "volatility3:vol"; do
  t="${pair%%:*}"; c="${pair##*:}"
  if GUEST /bin/sh -c "command -v $c >/dev/null 2>&1"; then OKP=$((OKP+1)); else MISSP="$MISSP $t"; fi
done
echo "pip: $OKP/12${MISSP:+ — miss:$MISSP}"

# ── 5) clone + wrappers (جوه الجست) ──
CLONES="
routersploit|threat9/routersploit|req|printf '#!/bin/sh\\\\nexec python3 /opt/routersploit/rsf.py \\"\$@\\"\\\\n' > /usr/local/bin/routersploit && chmod +x /usr/local/bin/routersploit|routersploit
photon|s0md3v/Photon|req|printf '#!/bin/sh\\\\nexec python3 /opt/photon/photon.py \\"\$@\\"\\\\n' > /usr/local/bin/photon && chmod +x /usr/local/bin/photon|photon
osintgram|Datalux/Osintgram||printf '#!/bin/sh\\\\nexec python3 /opt/osintgram/main.py \\"\$@\\"\\\\n' > /usr/local/bin/osintgram && chmod +x /usr/local/bin/osintgram|osintgram
pentestly|meatballs89/pentestly|req|printf '#!/bin/sh\\\\nexec python3 /opt/pentestly/pentestly.py \\"\$@\\"\\\\n' > /usr/local/bin/pentestly && chmod +x /usr/local/bin/pentestly|pentestly
ssrfmap|swisskyrepo/SSRFmap||printf '#!/bin/sh\\\\nexec python3 /opt/ssrfmap/ssrfmap.py \\"\$@\\"\\\\n' > /usr/local/bin/ssrfmap && chmod +x /usr/local/bin/ssrfmap|ssrfmap
gh-dork|molly/gh-dork|req|printf '#!/bin/sh\\\\nexec python3 /opt/gh-dork/gh-dork.py \\"\$@\\"\\\\n' > /usr/local/bin/gh-dork && chmod +x /usr/local/bin/gh-dork|gh-dork
evilgrade|infobyte/evilgrade||[ -f /opt/evilgrade/evilgrade.sh ] && cp /opt/evilgrade/evilgrade.sh /usr/local/bin/evilgrade && chmod +x /usr/local/bin/evilgrade; true|evilgrade
venom|r00t-3xp10it/venom||cp /opt/venom/venom.sh /usr/local/bin/venom && chmod +x /usr/local/bin/venom|venom
w3af|andresriancho/w3af|req|printf '#!/bin/sh\\\\nexec python3 /opt/w3af/w3af_console \\"\$@\\"\\\\n' > /usr/local/bin/w3af_console && cp /usr/local/bin/w3af_console /usr/local/bin/w3af && chmod +x /usr/local/bin/w3af_console /usr/local/bin/w3af|w3af_console
keepnote|mdrasmus/keepnote||[ -f /opt/keepnote/bin/keepnote ] && cp /opt/keepnote/bin/keepnote /usr/local/bin/keepnote && chmod +x /usr/local/bin/keepnote; true|keepnote
dvcs-ripper|kost/dvcs-ripper||for f in rip-git rip-svn rip-hg rip-bzr; do cp /opt/dvcs-ripper/\$f.pl /usr/local/bin/\$f 2>/dev/null && chmod +x /usr/local/bin/\$f; done; true|rip-git
king-phisher|CrimsonForge-io/king-phisher||[ -f /opt/king-phisher/KingPhisher ] && { printf '#!/bin/sh\\\\nexec python3 /opt/king-phisher/KingPhisher \\"\$@\\"\\\\n' > /usr/local/bin/king-phisher; chmod +x /usr/local/bin/king-phisher; }; true|king-phisher
"
OKC=0; MISSC=""
echo "$CLONES" | while IFS='|' read -r name repo req wrap gate; do
  [ -z "$name" ] && continue
  GUEST /bin/sh -c "rm -rf /opt/$name; git clone --depth 1 https://github.com/$repo /opt/$name 2>&1 | tail -1; [ '$req' = 'req' ] && (PIP_BREAK_SYSTEM_PACKAGES=1 pip3 install -q --ignore-installed -r /opt/$name/requirements.txt 2>&1 || true) | tail -1; $wrap" >> /tmp/provision.log 2>&1
  GUEST /bin/sh -c "command -v $gate >/dev/null 2>&1" && echo "OK:clone $name" || echo "MISS:clone $name"
done
for c in routersploit photon osintgram pentestly ssrfmap gh-dork evilgrade venom w3af_console keepnote rip-git king-phisher; do
  GUEST /bin/sh -c "command -v $c >/dev/null 2>&1" && OKC=$((OKC+1)) || MISSC="$MISSC $c"
done
echo "clones: $OKC/12${MISSC:+ — miss:$MISSC}"

# ── القياس النهائي داخل العقدة ──
FINAL="$(GUEST /bin/sh -c 'for t in ettercap exiftool steghide arp-scan cherrytree recordmydesktop wkhtmltopdf mp rainbowcrack redis-server elfutils ltrace strace zsh vim aria2 sidguess nxc crackmapexec pandoc legion fern-wifi-cracker casefile ghidraRun retdec-decompiler msfconsole powershell-empire faraday dradis amass subfinder naabu dnsx httpx katana cariddi bettercap asnmap shuffledns chisel mongosh grype syft trufflehog dockle subzy gotator maigret h8mail prowler scout pacu certipy-ad bloodhound-python sherlock sublist3r ssh-audit semgrep vol routersploit photon osintgram pentestly ssrfmap gh-dork evilgrade venom w3af_console keepnote rip-git king-phisher; do command -v $t >/dev/null 2>&1 && echo OK:$t; done' 2>/dev/null)"
OKN=$(echo "$FINAL" | grep -c '^OK:')
echo "::notice::provision: $OKN أدوات مثبتة ومتقالة على العقدة"
echo "$FINAL" > /tmp/provision-final.txt
date -u +%FT%TZ > "$HOME/kali-rootfs/.provision-done"
echo "provision DONE: $OKN"
exit 0
