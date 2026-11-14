#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# سحب واستخراج بيئة كالي الحقيقية من فرع kali-rootfs (اللي بناه CI).
# الـgit objects بتروح /tmp — مفيش أي حمل على حجم الريبو، والفروع موجودة
# على جيت هب فالاسترجاع بـأمر واحد في أي وقت.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
BRANCH="${NOVA_KALI_BRANCH:-kali-rootfs}"
REPO_SLUG="${NOVA_KALI_REPO_SLUG:-DawshaX/xFREEDOLLARHACHx}"
DEST="${NOVA_KALI_ROOT:-$(cd "$(dirname "$0")/.." && pwd)/.cache/kali/rootfs}"
TOKEN=$(gh auth token 2>/dev/null || true)
URL="https://github.com/${REPO_SLUG}.git"
[ -n "$TOKEN" ] && URL="https://x-access-token:${TOKEN}@github.com/${REPO_SLUG}.git"

echo "── [1/4] سحب فرع $BRANCH (shallow — objects في /tmp) ──"
GDIR=$(mktemp -d /tmp/kali-git.XXXXXX)
git -C "$GDIR" init -q
git -C "$GDIR" remote add origin "$URL"
git -C "$GDIR" fetch -q --depth=1 origin "$BRANCH"
REF=$(git -C "$GDIR" rev-parse FETCH_HEAD)
echo "   build ref: $REF"

echo "── [2/4] تفريغ ملفات الفرع + المانيفست ──"
BDIR=$(mktemp -d /tmp/kali-files.XXXXXX)
git -C "$GDIR" archive "$REF" | tar -x -C "$BDIR"
[ -f "$BDIR/MANIFEST.txt" ] || { echo "✗ MANIFEST مفقود — الفرع مش بناء rootfs"; exit 2; }
cat "$BDIR/MANIFEST.txt"

echo "── [3/4] فك الضغط zstd → tar → $DEST ──"
python3 -c "import zstandard" 2>/dev/null || pip install --break-system-packages -q zstandard
mkdir -p "$DEST"
cat "$BDIR"/part-* | python3 -c "
import sys, zstandard as zstd
d = zstd.ZstdDecompressor()
with d.stream_reader(sys.stdin.buffer) as r:
    while True:
        chunk = r.read(1 << 20)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
" | tar -xf - -C "$DEST"
rm -rf "$GDIR" "$BDIR"

echo "── [4/4] تحقق مقاس ──"
PRETTY=$(grep PRETTY_NAME "$DEST/etc/os-release" | cut -d'"' -f2)
echo "   PRETTY_NAME: $PRETTY"
echo "$PRETTY" | grep -qi kali || { echo "✗ مش كالي — الفحص فشل بصراحة"; exit 3; }
PKGS=$(grep -c '^Package:' "$DEST/var/lib/dpkg/status")
echo "   packages: $PKGS"
ls "$DEST/usr/bin/nmap" "$DEST/usr/bin/proot" "$DEST/usr/share/novnc" >/dev/null 2>&1 \
  && echo "   nmap + proot + novnc: موجودين ✓"
echo "✔ كالي الحقيقي مستخرجة في $DEST"
echo "  جرّب: $DEST/usr/bin/proot -R $DEST nmap --version   (أو scripts/kali-exec.sh 'nmap --version')"
