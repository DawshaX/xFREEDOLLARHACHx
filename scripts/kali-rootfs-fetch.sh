#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# سحب واستخراج بيئة كالي الحقيقية من فرع kali-rootfs — ببث streaming.
#
# حل المساحة (مقاس): النقل الكامل في pack واحد بيتقطع (HTTP 500) والمفكوك
# الكامل لوحده بياكل الدسك. هنا: كل جزء 90MB بيتنزل blob لوحده من partial
# clone، بيتتحقق SHA256 بتاعه، بيتدفق في مفكك zstd → tar ويتمسح فورًا.
# ⇒ الذروة على الدسك = حجم الاستخراج + 90MB بس. وكل حاجة بتفضل محفوظة
# دايمًا على جيت هب (الفرع = التخزين السحابي — بيرجع بأمر واحد أي وقت).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
BRANCH="${NOVA_KALI_BRANCH:-kali-rootfs}"
REPO_SLUG="${NOVA_KALI_REPO_SLUG:-DawshaX/xFREEDOLLARHACHx}"
DEST="${NOVA_KALI_ROOT:-${HOME:-/home/user}/kali-rootfs/rootfs}"
TMP_PART="/tmp/kali-part.tmp"
trap 'rm -rf "$GDIR" "$TMP_PART" /tmp/kali-files.* 2>/dev/null' EXIT
TOKEN=$(gh auth token 2>/dev/null || true)
URL="https://github.com/${REPO_SLUG}.git"
[ -n "$TOKEN" ] && URL="https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git"

echo "── [1/5] partial clone (blob:none — blobs تتنزل ملف-ملف عند الطلب) ──"
GDIR=$(mktemp -d /tmp/kali-git.XXXXXX)
git -C "$GDIR" init -q
git -C "$GDIR" remote add origin "$URL"
git -C "$GDIR" -c protocol.version=2 fetch -q --depth=1 --filter=blob:none origin "$BRANCH"
REF=$(git -C "$GDIR" rev-parse FETCH_HEAD)
echo "   build ref: $REF"

echo "── [2/5] المانيفست + قايمة الأجزاء والهاشات ──"
git -C "$GDIR" archive "$REF" -- MANIFEST.txt SHA256SUMS PACKAGES.txt 2>/dev/null | tar -x -C "$GDIR"
[ -f "$GDIR/MANIFEST.txt" ] || { echo "✗ MANIFEST مفقود — الفرع مش بناء rootfs"; exit 2; }
cat "$GDIR/MANIFEST.txt"
[ -f "$GDIR/SHA256SUMS" ] || { echo "✗ SHA256SUMS مفقود"; exit 2; }
PARTS=$(grep -oE 'part-[0-9]+' "$GDIR/SHA256SUMS" | sort -u | sort -t- -k2 -n)
N=$(echo "$PARTS" | wc -l)
echo "   الأجزاء: $N"

echo "── [3/5] proot-static من فرع kali-static (إجباري — قيس: الديناميكي بيطلب glibc أحدث) ──"
if git -C "$GDIR" -c protocol.version=2 fetch -q --depth=1 --filter=blob:none origin kali-static; then
  KS=$(git -C "$GDIR" rev-parse FETCH_HEAD)
  if git -C "$GDIR" cat-file blob "$KS:proot-static" > "$TMP_PART" 2>/dev/null; then
    mkdir -p "$DEST/usr/local/bin"
    mv "$TMP_PART" "$DEST/usr/local/bin/proot-static"
    chmod +x "$DEST/usr/local/bin/proot-static"
    "$DEST/usr/local/bin/proot-static" --version >/dev/null 2>&1 && echo "   proot-static ✓ مثبّت جوه البيئة" || echo "   ✗ static مش شغال (بصراحة)"
  else echo "   ✗ proot-static مش موجود في kali-static"; fi
else echo "   ✗ فرع kali-static مش متاح"; fi

echo "── [4/5] البث: جزء-بجزء (تحقق SHA256 لكل جزء) → zstd → tar → $DEST ──"
# gzip الأصلي في python3 — مفيش أي تثبيت
mkdir -p "$DEST"
cd "$GDIR"
{
  for p in $PARTS; do
    EXPECT=$(grep -E " ${p}$" SHA256SUMS | cut -d' ' -f1)
    OK=""
    for try in 1 2 3; do
      if git -C "$GDIR" cat-file blob "${REF}:${p}" > "$TMP_PART" 2>/dev/null; then
        ACTUAL=$(sha256sum "$TMP_PART" | cut -d' ' -f1)
        if [ "$ACTUAL" = "$EXPECT" ]; then OK=1; break; fi
        echo "   ✗ $p الهاش مش مطابق (محاولة $try)" >&2
      else echo "   ✗ $p متنزلش (محاولة $try)" >&2; fi
      sleep 5
    done
    if [ -z "$OK" ]; then echo "✗ الجزء $p فشل 3 محاولات — بصراحة، جرّب تاني" >&2; exit 5; fi
    echo "   ✓ $p ($(stat -c%s "$TMP_PART") bytes)" >&2
    cat "$TMP_PART"
    rm -f "$TMP_PART"
  done
} | python3 -c "
import sys, gzip, shutil
src = gzip.open(sys.stdin.buffer, 'rb')
shutil.copyfileobj(src, sys.stdout.buffer, 1 << 20)
src.close()
" | tar -xf - -C "$DEST"
TARST=$?
[ $TARST -eq 0 ] || { echo "✗ tar خرج بكود $TARST — مفيش مساحة؟ df -h / وشوف"; exit 6; }
echo "── [5/5] تحقق مقاس ──"
PRETTY=$(grep PRETTY_NAME "$DEST/etc/os-release" | cut -d'"' -f2)
echo "   PRETTY_NAME: $PRETTY"
echo "$PRETTY" | grep -qi kali || { echo "✗ مش كالي — الفحص فشل بصراحة"; exit 3; }
PKGS=$(grep -c '^Package:' "$DEST/var/lib/dpkg/status")
echo "   packages: $PKGS"
ls "$DEST/usr/bin/nmap" "$DEST/usr/local/bin/proot-static" "$DEST/usr/share/novnc" >/dev/null 2>&1 \
  && echo "   nmap + proot-static + novnc: موجودين ✓"
echo "✔ كالي الحقيقية كاملة مستخرجة في $DEST (والأصل دايمًا على فرع kali-rootfs — التخزين السحابي)"
echo "  جرّب: scripts/kali-exec.sh 'nmap --version'"
