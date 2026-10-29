const PRIVATE_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.home', '.corp'];
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function normalizeAsset(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('الأصل مطلوب');
  let value = input.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) value = 'https://' + value;
  let url;
  try { url = new URL(value); } catch { throw new Error('صيغة الأصل غير صالحة'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('يسمح فقط بـ http أو https');
  if (url.username || url.password) throw new Error('يمنع تضمين بيانات اعتماد في العنوان');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('يسمح فقط بالمنافذ 80 و443 في هذه النسخة');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error('اسم المضيف مطلوب');
  return { host, url: url.toString(), wildcard: host.startsWith('*.') };
}

export function validateScope(input, now = new Date()) {
  const reasons = [];
  const assetRaw = typeof input?.asset === 'string' ? input.asset : '';
  const program = typeof input?.program === 'string' ? input.program.trim() : '';
  const authorizationRef = typeof input?.authorizationRef === 'string' ? input.authorizationRef.trim() : '';
  const expiresAt = typeof input?.expiresAt === 'string' ? input.expiresAt : '';
  if (!program) reasons.push('اسم البرنامج مطلوب');
  if (!authorizationRef) reasons.push('مرجع التفويض مطلوب');
  // Date-only values from the UI remain valid through the end of that UTC day.
  const expiry = /^\d{4}-\d{2}-\d{2}$/.test(expiresAt) ? new Date(expiresAt + 'T23:59:59.999Z') : new Date(expiresAt);
  if (!expiresAt || Number.isNaN(expiry.getTime())) reasons.push('تاريخ انتهاء صالح مطلوب');
  else if (expiry.getTime() <= now.getTime()) reasons.push('التفويض منتهي الصلاحية');

  let normalized = null;
  let host = '';
  let wildcard = false;
  try {
    const parsed = normalizeAsset(assetRaw);
    host = parsed.host;
    wildcard = parsed.wildcard;
    normalized = parsed.url;
  } catch (err) {
    reasons.push(err.message);
  }

  if (host) {
    const bare = wildcard ? host.slice(2) : host;
    if (IPV4.test(bare) || bare.includes(':') || bare === 'localhost') {
      reasons.push('عناوين IP وlocalhost غير مسموحة في أداة التحقق التجريبية');
    }
    if (PRIVATE_SUFFIXES.some((suffix) => bare.endsWith(suffix))) reasons.push('نطاقات داخلية غير مسموحة');
    if (!bare.includes('.') || bare.startsWith('.') || bare.endsWith('.') || bare.includes('..')) reasons.push('اسم نطاق عام صالح مطلوب');
    if (wildcard && bare.split('.').length < 2) reasons.push('نطاق wildcard غير صالح');
  }

  return {
    ok: reasons.length === 0,
    mode: 'offline-policy-check',
    asset: normalized,
    host: host || null,
    wildcard,
    program: program || null,
    authorizationRef: authorizationRef || null,
    expiresAt: expiresAt || null,
    reasons,
    disclaimer: 'هذه مطابقة سياسة محلية فقط، وليست إثباتًا للتفويض ولا إذنًا ببدء الفحص. لا يتم إجراء أي اتصال بالهدف.'
  };
}

export function matchAsset(scopeHost, candidateHost) {
  const scope = String(scopeHost || '').toLowerCase().replace(/\.$/, '');
  const candidate = String(candidateHost || '').toLowerCase().replace(/\.$/, '');
  if (!scope || !candidate) return false;
  if (scope.startsWith('*.')) {
    const base = scope.slice(2);
    return candidate.endsWith('.' + base) && candidate.slice(0, -(base.length + 1)).length > 0 && !candidate.slice(0, -(base.length + 1)).includes('.');
  }
  return scope === candidate;
}
