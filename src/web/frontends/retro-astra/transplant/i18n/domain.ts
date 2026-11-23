import type { Language } from './messages';

/** Canonical stored values stay unchanged; only known demo text is localized. */
const persian: Record<string, string> = {
  'Stallion': 'نریان', 'Mare': 'مادیان', 'Gelding': 'اخته',
  'At stud': 'مولد', 'In training': 'در تمرین', 'Retired': 'بازنشسته',
  'Thoroughbred': 'تروبرد', 'Warmblood': 'خون‌گرم', 'Irish Sport Horse': 'اسب ورزشی ایرلندی',
  'Connemara': 'کونمارا', 'Arabian': 'عرب', 'Other': 'سایر',
  'Bay': 'کهر', 'Dark bay': 'کهر تیره', 'Chestnut': 'کرنگ', 'Grey': 'خاکستری',
  'Black': 'سیاه', 'Palomino': 'پالومینو', 'Piebald': 'ابلق',
  'Not recorded': 'ثبت نشده', 'My stable': 'اصطبل من',
  'GB': 'بریتانیا', 'IE': 'ایرلند', 'IRE': 'ایرلند', 'US': 'آمریکا', 'FR': 'فرانسه', 'DE': 'آلمان', 'AU': 'استرالیا',
  'United Kingdom': 'بریتانیا', 'Ireland': 'ایرلند', 'United States': 'آمریکا', 'France': 'فرانسه', 'Germany': 'آلمان', 'Australia': 'استرالیا',
  'green': 'سبز', 'rust': 'سفالی', 'gold': 'طلایی', 'blue': 'آبی',
  'Oakfield Sovereign': 'اوکفیلد ساورین', 'Willowbrook': 'ویلوبروک', 'Copper Coast': 'کاپر کوست',
  'Fern Hill': 'فرن هیل', 'Sunday Edition': 'ساندی ادیشن', 'Hazel & Honey': 'هیزل و هانی',
  "King's Legacy": 'کینگز لگسی', 'Autumn Rose': 'آتمن رز', 'Royal Accord': 'رویال آکورد',
  'Silver Lining': 'سیلور لاینینگ', 'Amber Prince': 'امبر پرینس', 'Wildflower': 'وایلدفلاور',
  'Northern Light': 'نوردرن لایت', 'Crown Jewel': 'کراون جول', 'Silver Sentinel': 'سیلور سنتینل',
  'Morning Mist': 'مورنینگ میست', 'Golden Hour': 'گلدن آور', 'Meadow King': 'مدو کینگ',
  'Rosewood': 'رزوود', 'Bracken': 'براکن', 'James': 'جیمز',
  'Oakfield Stud, Newmarket': 'مرکز پرورش اوکفیلد، نیومارکت', 'Oakfield Stud': 'مرکز پرورش اوکفیلد',
  'The Oakfield Partnership': 'مشارکت اوکفیلد',
  'The home stable': 'اصطبل خانه', 'Breeding shortlist': 'گزینه‌های پرورش', 'Ones to watch': 'آینده‌دارها',
  'The familiar faces. Horses we know, love, and work with every day.': 'چهره‌های آشنا؛ اسب‌هایی که هر روز می‌شناسیم، دوستشان داریم و با آن‌ها کار می‌کنیم.',
  'Thoughtful pairings and promising bloodlines for the next chapter.': 'جفت‌های سنجیده و تبارهای امیدبخش برای فصل آینده.',
  'Young prospects with a little something special.': 'اسب‌های جوانی با ویژگی‌های خاص و آینده‌ای روشن.',
  'A thoughtfully gathered collection of horses.': 'مجموعه‌ای از اسب‌ها که با دقت گردآوری شده‌اند.',
  'A new chapter in your Studbook. Add a note to start telling this horse\'s story.': 'فصلی تازه در کتاب تبارنامه شما؛ با افزودن یک یادداشت، داستان این اسب را آغاز کنید.',
  'A beautifully balanced bay with a generous stride and a wonderfully steady temperament. Oakfield Sovereign brings together the proven King\'s Legacy sire line and the enduring quality of the Autumn Rose family. Now standing at Oakfield Stud.': 'اسبی کهر با اندامی متوازن، گام‌های بلند و خلق‌وخویی آرام. اوکفیلد ساورین تبار پدری درخشان کینگز لگسی را با اصالت ماندگار خانواده آتمن رز پیوند می‌دهد. اکنون در مرکز پرورش اوکفیلد نگهداری می‌شود.',
  'An exceptionally calm temperament at the spring viewing. Revisit his dam line when putting together the breeding shortlist.': 'در بازدید بهاری بسیار آرام بود. هنگام تهیه فهرست گزینه‌های پرورش، تبار مادری او دوباره بررسی شود.',
  'Look a little further into Autumn Rose\'s dam line.\n\nAnd take another look at Willowbrook. There\'s something about that mare.': 'تبار مادری آتمن رز را کمی بیشتر بررسی کن.\n\nو دوباره به ویلوبروک سر بزن؛ این مادیان ویژگی خاصی دارد.',
};

const arabic: Record<string, string> = {
  'Stallion': 'فحل', 'Mare': 'فرس', 'Gelding': 'مخصي',
  'At stud': 'فحل تلقيح', 'In training': 'قيد التدريب', 'Retired': 'معتزل',
  'Thoroughbred': 'ثوروبريد', 'Warmblood': 'دم حار', 'Irish Sport Horse': 'حصان رياضي أيرلندي',
  'Connemara': 'كونيمارا', 'Arabian': 'عربي', 'Other': 'أخرى',
  'Bay': 'كهر', 'Dark bay': 'كهر داكن', 'Chestnut': 'كستنائي', 'Grey': 'رمادي',
  'Black': 'أسود', 'Palomino': 'بالومينو', 'Piebald': 'أبلق',
  'Not recorded': 'غير مسجّل', 'My stable': 'إسطبلي',
  'GB': 'بريطانيا', 'IE': 'أيرلندا', 'IRE': 'أيرلندا', 'US': 'أمريكا', 'FR': 'فرنسا', 'DE': 'ألمانيا', 'AU': 'أستراليا',
  'United Kingdom': 'المملكة المتحدة', 'Ireland': 'أيرلندا', 'United States': 'الولايات المتحدة', 'France': 'فرنسا', 'Germany': 'ألمانيا', 'Australia': 'أستراليا',
  'green': 'أخضر', 'rust': 'صدئ', 'gold': 'ذهبي', 'blue': 'أزرق',
  'Oakfield Sovereign': 'أوكفيلد سفرين', 'Willowbrook': 'ويلوبروك', 'Copper Coast': 'كوبر كوست',
  'Fern Hill': 'فرن هيل', 'Sunday Edition': 'صنداي إديشن', 'Hazel & Honey': 'هازل آند هوني',
  "King's Legacy": 'إرث الملك', 'Autumn Rose': 'وردة الخريف', 'Royal Accord': 'الوِفاق الملكي',
  'Silver Lining': 'بطانة فضية', 'Amber Prince': 'الأمير الكهرماني', 'Wildflower': 'الزهرة البرية',
  'Northern Light': 'الشمالية', 'Crown Jewel': 'جوهرة التاج', 'Silver Sentinel': 'الحارس الفضي',
  'Morning Mist': 'ضباب الصباح', 'Golden Hour': 'الساعة الذهبية', 'Meadow King': 'ملك المروج',
  'Rosewood': 'خشب الورد', 'Bracken': 'السرخس', 'James': 'جيمس',
  'Oakfield Stud, Newmarket': 'مشتل أوكفيلد، نيوماركت', 'Oakfield Stud': 'مشتل أوكفيلد',
  'The Oakfield Partnership': 'شراكة أوكفيلد',
  'The home stable': 'الإسطبل البيتي', 'Breeding shortlist': 'قائمة التربية', 'Ones to watch': 'آمال المستقبل',
  'The familiar faces. Horses we know, love, and work with every day.': 'وجوه مألوفة؛ خيول نعرفها ونحبها ونعمل معها كل يوم.',
  'Thoughtful pairings and promising bloodlines for the next chapter.': 'اقترانات مدروسة وأنساب واعدة للفصل القادم.',
  'Young prospects with a little something special.': 'خيول فتية بشيء خاص مميز.',
  'A thoughtfully gathered collection of horses.': 'مجموعة خيول جُمعت بعناية.',
};

export function localizeDomain(value: string, language: Language): string {
  if (language === 'en') return value;
  if (language === 'ar') {
    if (arabic[value]) return arabic[value];
    const suffixAr = ' is part of the Oakfield reference bloodline, selected for sound conformation, an even temperament, and a distinguished family record. This is a fictional horse created for the Studbook demo.';
    if (value.endsWith(suffixAr)) return `${localizeDomain(value.slice(0, -suffixAr.length), language)} من النسب المرجعي لأوكفيلد، اختير لسلامة بنيته واعتدال طبعه وسجل عائلته المرموق. هذا حصان افتراضي أُنشئ لعرض كتاب الأنساب.`;
    if (/^\d+(\.\d+)? hh$/.test(value)) return `${value.replace(' hh', '').replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)])} يد`;
    return value;
  }
  if (persian[value]) return persian[value];
  const suffix = ' is part of the Oakfield reference bloodline, selected for sound conformation, an even temperament, and a distinguished family record. This is a fictional horse created for the Studbook demo.';
  if (value.endsWith(suffix)) return `${localizeDomain(value.slice(0, -suffix.length), language)} از تبار مرجع اوکفیلد است و به‌خاطر اندام سالم، خلق‌وخوی آرام و پیشینه خانوادگی ممتاز انتخاب شده است. این اسب برای نسخه نمایشی کتاب تبارنامه ساخته شده است.`;
  if (/^\d+(\.\d+)? hh$/.test(value)) return `${value.replace(' hh', '').replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])} هند`;
  return value;
}

export function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase()
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u200C\u200D]/g, '').replace(/[٬,]/g, '').replace(/٫/g, '.')
    .replace(/\s+/g, ' ').trim();
}