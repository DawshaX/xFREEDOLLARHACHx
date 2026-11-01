/**
 * NOVA — 25-language UI layer
 * ───────────────────────────
 * The panel was Arabic + English only, hardcoded in the components. This module
 * gives it a real language system:
 *
 *   • every registered language has its own row of strings,
 *   • the choice is remembered (localStorage) and applied to `<html dir>` so
 *     Arabic/Hebrew/Persian/Urdu flip the layout to RTL,
 *   • `coverage()` reports how much of each language is really translated —
 *     a missing string falls back to English and is COUNTED, never faked.
 *
 * Scope, stated honestly: this covers the application shell (connection state,
 * common actions, section titles). Deep page content is still bilingual
 * Arabic/English — the fallback below makes that visible instead of silent.
 */

export type LangCode =
  | "ar" | "en" | "fr" | "es" | "de" | "it" | "pt" | "ru" | "tr" | "hi"
  | "ur" | "fa" | "id" | "ms" | "zh" | "ja" | "ko" | "nl" | "pl" | "uk"
  | "vi" | "th" | "sw" | "he" | "el";

export interface LangInfo {
  code: LangCode;
  label: string;   // name in its own script
  english: string; // name in English
  dir: "ltr" | "rtl";
}

export const LANGS: LangInfo[] = [
  { code: "ar", label: "العربية", english: "Arabic", dir: "rtl" },
  { code: "en", label: "English", english: "English", dir: "ltr" },
  { code: "fr", label: "Français", english: "French", dir: "ltr" },
  { code: "es", label: "Español", english: "Spanish", dir: "ltr" },
  { code: "de", label: "Deutsch", english: "German", dir: "ltr" },
  { code: "it", label: "Italiano", english: "Italian", dir: "ltr" },
  { code: "pt", label: "Português", english: "Portuguese", dir: "ltr" },
  { code: "ru", label: "Русский", english: "Russian", dir: "ltr" },
  { code: "tr", label: "Türkçe", english: "Turkish", dir: "ltr" },
  { code: "hi", label: "हिन्दी", english: "Hindi", dir: "ltr" },
  { code: "ur", label: "اردو", english: "Urdu", dir: "rtl" },
  { code: "fa", label: "فارسی", english: "Persian", dir: "rtl" },
  { code: "id", label: "Bahasa Indonesia", english: "Indonesian", dir: "ltr" },
  { code: "ms", label: "Bahasa Melayu", english: "Malay", dir: "ltr" },
  { code: "zh", label: "中文", english: "Chinese", dir: "ltr" },
  { code: "ja", label: "日本語", english: "Japanese", dir: "ltr" },
  { code: "ko", label: "한국어", english: "Korean", dir: "ltr" },
  { code: "nl", label: "Nederlands", english: "Dutch", dir: "ltr" },
  { code: "pl", label: "Polski", english: "Polish", dir: "ltr" },
  { code: "uk", label: "Українська", english: "Ukrainian", dir: "ltr" },
  { code: "vi", label: "Tiếng Việt", english: "Vietnamese", dir: "ltr" },
  { code: "th", label: "ไทย", english: "Thai", dir: "ltr" },
  { code: "sw", label: "Kiswahili", english: "Swahili", dir: "ltr" },
  { code: "he", label: "עברית", english: "Hebrew", dir: "rtl" },
  { code: "el", label: "Ελληνικά", english: "Greek", dir: "ltr" },
];

/**
 * Every row in DICT is positionally aligned with KEYS.
 * Adding a string means adding it here and appending to each language row.
 */
export const KEYS = [
  "connected", "online", "offline", "loading", "error", "retry",
  "search", "run", "stop", "save", "cancel", "delete", "copy", "refresh",
  "close", "send", "settings", "language", "dashboard", "chat", "memory",
  "fleet", "tools", "logs", "version", "help",
  "sec_command", "sec_neural", "sec_exploit", "sec_intel", "sec_tools", "sec_data",
] as const;

export type TKey = (typeof KEYS)[number];

const DICT: Record<LangCode, string[]> = {
  en: ["Connected","Online","Offline","Loading","Error","Retry","Search","Run","Stop","Save","Cancel","Delete","Copy","Refresh","Close","Send","Settings","Language","Dashboard","Chat","Memory","Fleet","Tools","Logs","Version","Help","Command Center","AI · Neural Ops","Exploit · Vuln Ops","Threat Intel","Offensive Tools","Data & Intel"],
  ar: ["متصل","متاح","غير متاح","جاري التحميل","خطأ","إعادة المحاولة","بحث","تشغيل","إيقاف","حفظ","إلغاء","حذف","نسخ","تحديث","إغلاق","إرسال","الإعدادات","اللغة","لوحة التحكم","محادثة","الذاكرة","الأسطول","الأدوات","السجلات","الإصدار","مساعدة","مركز القيادة","العمليات العصبية","الثغرات والهجمات","الاستخبارات","الأدوات الهجومية","البيانات والاستخبارات"],
  fr: ["Connecté","En ligne","Hors ligne","Chargement","Erreur","Réessayer","Rechercher","Exécuter","Arrêter","Enregistrer","Annuler","Supprimer","Copier","Actualiser","Fermer","Envoyer","Paramètres","Langue","Tableau de bord","Discussion","Mémoire","Flotte","Outils","Journaux","Version","Aide","Centre de commandement","Opérations neuronales","Exploits et vulnérabilités","Renseignement","Outils offensifs","Données et renseignement"],
  es: ["Conectado","En línea","Desconectado","Cargando","Error","Reintentar","Buscar","Ejecutar","Detener","Guardar","Cancelar","Eliminar","Copiar","Actualizar","Cerrar","Enviar","Ajustes","Idioma","Panel","Chat","Memoria","Flota","Herramientas","Registros","Versión","Ayuda","Centro de mando","Operaciones neuronales","Exploits y vulnerabilidades","Inteligencia","Herramientas ofensivas","Datos e inteligencia"],
  de: ["Verbunden","Online","Offline","Laden","Fehler","Wiederholen","Suchen","Ausführen","Stopp","Speichern","Abbrechen","Löschen","Kopieren","Aktualisieren","Schließen","Senden","Einstellungen","Sprache","Übersicht","Chat","Speicher","Flotte","Werkzeuge","Protokolle","Version","Hilfe","Kommandozentrale","Neuronale Abläufe","Exploits und Schwachstellen","Bedrohungsdaten","Offensive Werkzeuge","Daten und Aufklärung"],
  it: ["Connesso","Online","Offline","Caricamento","Errore","Riprova","Cerca","Esegui","Ferma","Salva","Annulla","Elimina","Copia","Aggiorna","Chiudi","Invia","Impostazioni","Lingua","Dashboard","Chat","Memoria","Flotta","Strumenti","Registri","Versione","Aiuto","Centro di comando","Operazioni neurali","Exploit e vulnerabilità","Intelligence","Strumenti offensivi","Dati e intelligence"],
  pt: ["Conectado","Online","Offline","Carregando","Erro","Tentar novamente","Pesquisar","Executar","Parar","Salvar","Cancelar","Excluir","Copiar","Atualizar","Fechar","Enviar","Configurações","Idioma","Painel","Chat","Memória","Frota","Ferramentas","Registros","Versão","Ajuda","Centro de comando","Operações neurais","Exploits e vulnerabilidades","Inteligência","Ferramentas ofensivas","Dados e inteligência"],
  ru: ["Подключено","В сети","Не в сети","Загрузка","Ошибка","Повторить","Поиск","Запустить","Стоп","Сохранить","Отмена","Удалить","Копировать","Обновить","Закрыть","Отправить","Настройки","Язык","Панель","Чат","Память","Флот","Инструменты","Журналы","Версия","Помощь","Командный центр","Нейронные операции","Эксплойты и уязвимости","Разведка угроз","Наступательные инструменты","Данные и разведка"],
  tr: ["Bağlı","Çevrimiçi","Çevrimdışı","Yükleniyor","Hata","Yeniden dene","Ara","Çalıştır","Durdur","Kaydet","İptal","Sil","Kopyala","Yenile","Kapat","Gönder","Ayarlar","Dil","Panel","Sohbet","Bellek","Filo","Araçlar","Günlükler","Sürüm","Yardım","Komuta merkezi","Sinirsel operasyonlar","Açıklar ve güvenlik açıkları","Tehdit istihbaratı","Saldırı araçları","Veri ve istihbarat"],
  hi: ["जुड़ा हुआ","ऑनलाइन","ऑफ़लाइन","लोड हो रहा है","त्रुटि","फिर कोशिश करें","खोजें","चलाएँ","रोकें","सहेजें","रद्द करें","हटाएँ","कॉपी","रीफ़्रेश","बंद करें","भेजें","सेटिंग्स","भाषा","डैशबोर्ड","चैट","मेमोरी","फ़्लीट","टूल्स","लॉग","संस्करण","सहायता","कमांड सेंटर","तंत्रिका संचालन","एक्सप्लॉइट और कमज़ोरियाँ","ख़ुफ़िया","आक्रामक टूल्स","डेटा और ख़ुफ़िया"],
  ur: ["منسلک","آن لائن","آف لائن","لوڈ ہو رہا ہے","خرابی","دوبارہ کوشش","تلاش","چلائیں","روکیں","محفوظ کریں","منسوخ","حذف","نقل","تازہ کریں","بند کریں","بھیجیں","ترتیبات","زبان","ڈیش بورڈ","چیٹ","میموری","بیڑا","اوزار","لاگز","ورژن","مدد","کمانڈ سینٹر","عصبی کارروائیاں","ایکسپلائٹ اور کمزوریاں","انٹیلیجنس","حملہ آور اوزار","ڈیٹا اور انٹیلیجنس"],
  fa: ["متصل","آنلاین","آفلاین","در حال بارگذاری","خطا","تلاش مجدد","جستجو","اجرا","توقف","ذخیره","لغو","حذف","کپی","به‌روزرسانی","بستن","ارسال","تنظیمات","زبان","داشبورد","گفتگو","حافظه","ناوگان","ابزارها","گزارش‌ها","نسخه","راهنما","مرکز فرمان","عملیات عصبی","اکسپلویت و آسیب‌پذیری","اطلاعات تهدید","ابزارهای تهاجمی","داده و اطلاعات"],
  id: ["Terhubung","Daring","Luring","Memuat","Kesalahan","Coba lagi","Cari","Jalankan","Hentikan","Simpan","Batal","Hapus","Salin","Segarkan","Tutup","Kirim","Pengaturan","Bahasa","Dasbor","Obrolan","Memori","Armada","Alat","Log","Versi","Bantuan","Pusat komando","Operasi neural","Eksploit dan kerentanan","Intelijen ancaman","Alat ofensif","Data dan intelijen"],
  ms: ["Bersambung","Dalam talian","Luar talian","Memuatkan","Ralat","Cuba lagi","Cari","Jalankan","Hentikan","Simpan","Batal","Padam","Salin","Muat semula","Tutup","Hantar","Tetapan","Bahasa","Papan pemuka","Sembang","Memori","Armada","Alat","Log","Versi","Bantuan","Pusat arahan","Operasi neural","Eksploit dan kerentanan","Perisikan ancaman","Alat menyerang","Data dan perisikan"],
  zh: ["已连接","在线","离线","加载中","错误","重试","搜索","运行","停止","保存","取消","删除","复制","刷新","关闭","发送","设置","语言","仪表板","聊天","记忆","舰队","工具","日志","版本","帮助","指挥中心","神经运算","漏洞利用","威胁情报","攻击工具","数据与情报"],
  ja: ["接続済み","オンライン","オフライン","読み込み中","エラー","再試行","検索","実行","停止","保存","キャンセル","削除","コピー","更新","閉じる","送信","設定","言語","ダッシュボード","チャット","メモリ","フリート","ツール","ログ","バージョン","ヘルプ","コマンドセンター","ニューラル運用","エクスプロイトと脆弱性","脅威インテリジェンス","攻撃ツール","データとインテリジェンス"],
  ko: ["연결됨","온라인","오프라인","로딩 중","오류","다시 시도","검색","실행","중지","저장","취소","삭제","복사","새로고침","닫기","보내기","설정","언어","대시보드","채팅","메모리","플릿","도구","로그","버전","도움말","지휘 센터","신경 연산","취약점 공격","위협 정보","공격 도구","데이터 및 정보"],
  nl: ["Verbonden","Online","Offline","Laden","Fout","Opnieuw","Zoeken","Uitvoeren","Stoppen","Opslaan","Annuleren","Verwijderen","Kopiëren","Vernieuwen","Sluiten","Verzenden","Instellingen","Taal","Dashboard","Chat","Geheugen","Vloot","Hulpmiddelen","Logboeken","Versie","Help","Commandocentrum","Neurale operaties","Exploits en kwetsbaarheden","Dreigingsinformatie","Offensieve hulpmiddelen","Data en inlichtingen"],
  pl: ["Połączono","Online","Offline","Ładowanie","Błąd","Ponów","Szukaj","Uruchom","Zatrzymaj","Zapisz","Anuluj","Usuń","Kopiuj","Odśwież","Zamknij","Wyślij","Ustawienia","Język","Panel","Czat","Pamięć","Flota","Narzędzia","Dzienniki","Wersja","Pomoc","Centrum dowodzenia","Operacje neuronowe","Exploity i podatności","Wywiad zagrożeń","Narzędzia ofensywne","Dane i wywiad"],
  uk: ["Підключено","У мережі","Поза мережею","Завантаження","Помилка","Повторити","Пошук","Запустити","Стоп","Зберегти","Скасувати","Видалити","Копіювати","Оновити","Закрити","Надіслати","Налаштування","Мова","Панель","Чат","Пам'ять","Флот","Інструменти","Журнали","Версія","Довідка","Командний центр","Нейронні операції","Експлойти та вразливості","Розвідка загроз","Наступальні інструменти","Дані та розвідка"],
  vi: ["Đã kết nối","Trực tuyến","Ngoại tuyến","Đang tải","Lỗi","Thử lại","Tìm kiếm","Chạy","Dừng","Lưu","Hủy","Xóa","Sao chép","Làm mới","Đóng","Gửi","Cài đặt","Ngôn ngữ","Bảng điều khiển","Trò chuyện","Bộ nhớ","Hạm đội","Công cụ","Nhật ký","Phiên bản","Trợ giúp","Trung tâm chỉ huy","Vận hành nơ-ron","Khai thác và lỗ hổng","Tình báo mối đe dọa","Công cụ tấn công","Dữ liệu và tình báo"],
  th: ["เชื่อมต่อแล้ว","ออนไลน์","ออฟไลน์","กำลังโหลด","ข้อผิดพลาด","ลองใหม่","ค้นหา","เรียกใช้","หยุด","บันทึก","ยกเลิก","ลบ","คัดลอก","รีเฟรช","ปิด","ส่ง","การตั้งค่า","ภาษา","แดชบอร์ด","แชท","หน่วยความจำ","ฝูงบิน","เครื่องมือ","บันทึกระบบ","เวอร์ชัน","ช่วยเหลือ","ศูนย์บัญชาการ","ปฏิบัติการประสาท","ช่องโหว่และการโจมตี","ข่าวกรองภัยคุกคาม","เครื่องมือโจมตี","ข้อมูลและข่าวกรอง"],
  sw: ["Imeunganishwa","Mtandaoni","Nje ya mtandao","Inapakia","Hitilafu","Jaribu tena","Tafuta","Endesha","Simamisha","Hifadhi","Ghairi","Futa","Nakili","Onyesha upya","Funga","Tuma","Mipangilio","Lugha","Dashibodi","Gumzo","Kumbukumbu","Kundi la meli","Zana","Rejista","Toleo","Msaada","Kituo cha amri","Uendeshaji wa neva","Usalishaji na mianya","Ujasusi wa vitisho","Zana za mashambulizi","Data na ujasusi"],
  he: ["מחובר","מקוון","לא מקוון","טוען","שגיאה","נסה שוב","חיפוש","הרצה","עצור","שמור","ביטול","מחק","העתק","רענן","סגור","שלח","הגדרות","שפה","לוח בקרה","צ'אט","זיכרון","צי","כלים","יומנים","גרסה","עזרה","מרכז פיקוד","פעולות עצביות","ניצול ופגיעויות","מודיעין איומים","כלי תקיפה","נתונים ומודיעין"],
  el: ["Συνδεδεμένο","Σε σύνδεση","Εκτός σύνδεσης","Φόρτωση","Σφάλμα","Δοκιμή ξανά","Αναζήτηση","Εκτέλεση","Διακοπή","Αποθήκευση","Άκυρο","Διαγραφή","Αντιγραφή","Ανανέωση","Κλείσιμο","Αποστολή","Ρυθμίσεις","Γλώσσα","Πίνακας ελέγχου","Συνομιλία","Μνήμη","Στόλος","Εργαλεία","Αρχεία καταγραφής","Έκδοση","Βοήθεια","Κέντρο διοίκησης","Νευρωνικές λειτουργίες","Εκμετάλλευση και ευπάθειες","Πληροφορίες απειλών","Επιθετικά εργαλεία","Δεδομένα και πληροφορίες"],
};

const STORAGE_KEY = "cybernova.lang";
const FALLBACK: LangCode = "en";

export function isLang(code: string | null | undefined): code is LangCode {
  return Boolean(code) && LANGS.some((l) => l.code === code);
}

/** Best guess for a first visit: stored choice → browser → English. */
export function detectLang(): LangCode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    /* private mode */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "";
  if (isLang(nav)) return nav;
  return "ar"; // the product's home language
}

export function saveLang(code: LangCode): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* ignore */
  }
}

export function dirOf(code: LangCode): "ltr" | "rtl" {
  return LANGS.find((l) => l.code === code)?.dir ?? "ltr";
}

/** One string, with an explicit fallback chain. */
export function translate(code: LangCode, key: TKey): string {
  const row = DICT[code];
  const idx = KEYS.indexOf(key);
  const value = row?.[idx];
  if (value && value.trim()) return value;
  return DICT[FALLBACK][idx] ?? key;
}

/** Real translation ratio per language — used by the coverage report. */
export function coverage(): Array<{ code: LangCode; strings: number; missing: number; percent: number }> {
  return LANGS.map((l) => {
    const row = DICT[l.code] ?? [];
    const missing = KEYS.filter((_, i) => !row[i] || !row[i].trim()).length;
    const strings = KEYS.length - missing;
    return {
      code: l.code,
      strings,
      missing,
      percent: Math.round((strings / KEYS.length) * 100),
    };
  });
}
