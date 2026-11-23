// R158: Latin -> Farsi (Persian) name transliterator for registry people.
// Two-layer design:
//   1) curated token dictionary (covers the vast majority of Iranian name tokens)
//   2) ordered grapheme-rule fallback for unknown tokens
// Exported for reuse; not a worker module (runs under Node for data backfills).

const D = {
  // honorifics / particles / connectors
  's.': 'س.', 's': 'س', 'seyed': 'سید', 'sayed': 'سید', 'syed': 'سید', 'seyyed': 'سید',
  'mir': 'میر', 'shah': 'شاه', 'malek': 'ملک', 'malik': 'ملک', 'agha': 'آقا', 'aqa': 'آقا', 'agh': 'آقا',
  'ale': 'آل', 'allah': 'الله', 'din': 'الدین', 'beig': 'بیگ', 'beyg': 'بیگ', 'beg': 'بیگ',
  'khan': 'خان', 'soltan': 'سلطان', 'sultan': 'سلطان', 'emad': 'عماد', 'od': 'الدین', 'ed': 'الدین',
  // common given names (male)
  'mohammad': 'محمد', 'mohamad': 'محمد', 'muhammad': 'محمد', 'ali': 'علی', 'reza': 'رضا', 'hosein': 'حسین',
  'hossein': 'حسین', 'hussain': 'حسین', 'hossain': 'حسین', 'hussein': 'حسین', 'mahdi': 'مهدی', 'mehdi': 'مهدی',
  'amir': 'امیر', 'abdol': 'عبدال', 'abdul': 'عبدال', 'abd': 'عبد', 'hamid': 'حمید', 'hasan': 'حسن',
  'hassan': 'حسن', 'alireza': 'علیرضا', 'ahmad': 'احمد', 'mohsen': 'محسن', 'abbas': 'عباس', 'majid': 'مجید',
  'saeid': 'سعید', 'saeed': 'سعید', 'said': 'سعید', 'mostafa': 'مصطفی', 'mustafa': 'مصطفی', 'javad': 'جواد',
  'mahmoud': 'محمود', 'mahmud': 'محمود', 'hadi': 'هادی', 'amin': 'امین', 'ebrahim': 'ابراهیم', 'ibrahim': 'ابراهیم',
  'massoud': 'مسعود', 'masoud': 'مسعود', 'masud': 'مسعود', 'morteza': 'مرتضی', 'mortaza': 'مرتضی',
  'abolfazl': 'ابوالفضل', 'abalfazl': 'ابوالفضل', 'mojtaba': 'مجتبی', 'musavi': 'موسوی', 'akbar': 'اکبر',
  'hamed': 'حامد', 'ehsan': 'احسان', 'vahid': 'وحید', 'nasser': 'ناصر', 'nasr': 'ناصر', 'gholam': 'غلام',
  'gholamreza': 'غلامرضا', 'esmaeil': 'اسماعیل', 'ismaeil': 'اسماعیل', 'ismail': 'اسماعیل', 'yousef': 'یوسف',
  'yusuf': 'یوسف', 'yoosof': 'یوسف', 'abdollah': 'عبدالله', 'abdallah': 'عبدالله', 'rasoul': 'رسول',
  'rasul': 'رسول', 'sadegh': 'صادق', 'sadeq': 'صادق', 'karim': 'کریم', 'farhad': 'فرهاد', 'asghar': 'اصغر',
  'davoud': 'داوود', 'davood': 'داوود', 'dawood': 'داوود', 'omid': 'امید', 'sajad': 'سجاد', 'mansour': 'منصور',
  'ghorban': 'قربان', 'ghurban': 'قربان', 'milad': 'میلاد', 'rahman': 'رحمان', 'rahmat': 'رحمت', 'bahram': 'بهرام',
  'behnam': 'بهنام', 'babak': 'بابک', 'kaveh': 'کاوه', 'siavash': 'سیاوش', 'arash': 'آرش', 'ardalan': 'اردلان',
  'behzad': 'بهزاد', 'bijan': 'بیژن', 'bizhan': 'بیژن', 'dariush': 'داریوش', 'daryoush': 'داریوش', 'daryush': 'داریوش',
  'fariborz': 'فریبرز', 'farzad': 'فرزاد', 'fereydoon': 'فریدون', 'fereidoun': 'فریدون', 'firouz': 'فیروز',
  'pirouz': 'فیروز', 'ghobad': 'قباد', 'habib': 'حبیب', 'iraj': 'ایرج', 'jalal': 'جلال', 'jamshid': 'جمشید',
  'kourosh': 'کوروش', 'kurosh': 'کوروش', 'keyvan': 'کیوان', 'keivan': 'کیوان', 'kiarash': 'کیارش',
  'masih': 'مسیح', 'mehrdad': 'مهرداد', 'mehran': 'مهران', 'mehrzad': 'مهرزاد', 'meysam': 'میثم',
  'meisam': 'میثم', 'navid': 'نوید', 'nima': 'نیما', 'parviz': 'پرویز', 'pedram': 'پدرام', 'peyman': 'پیمان',
  'peiman': 'پیمان', 'pouya': 'پویا', 'pooya': 'پویا', 'ramtin': 'رامتین', 'saman': 'سامان', 'sasan': 'ساسان',
  'sepehr': 'سپهر', 'shahin': 'شاهین', 'shahram': 'شهرام', 'siamak': 'سیامک', 'sohrab': 'سهراب', 'soheil': 'سهیل',
  'soroush': 'سروش', 'sorush': 'سروش', 'saman': 'سامان', 'taghi': 'تقی', 'taqavi': 'تقوی', 'taher': 'طاهر',
  'tahir': 'طاهر', 'vahdat': 'وحدت', 'nader': 'نادر', 'nemat': 'نعمت', 'ramin': 'رامین', 'rohollah': 'روح‌الله',
  'rouhollah': 'روح‌الله', 'roohollah': 'روح‌الله', 'ruhollah': 'روح‌الله', 'samad': 'صمد', 'sattar': 'ستار',
  'shapour': 'شاپور', 'shapur': 'شاپور', 'shervin': 'شروین', 'sobhan': 'سبحان', 'zia': 'ضیا', 'ziya': 'ضیا',
  'mosa': 'موسی', 'mousa': 'موسی', 'musa': 'موسی', 'hashem': 'هاشم', 'hashim': 'هاشم', 'esmail': 'اسماعیل',
  'ghasem': 'قاسم', 'qasem': 'قاسم', 'kazem': 'کاظم', 'musa': 'موسی', 'yahya': 'یحیی', 'yaghoub': 'یعقوب',
  'yaqub': 'یعقوب', 'yousefali': 'یوسف علی', 'moharram': 'محرّم', 'mohram': 'محرّم', 'zeynal': 'زینل',
  'zeynol': 'زین‌العابدین', 'bagher': 'باقر', 'baqer': 'باقر', 'musa': 'موسی', 'shokrallah': 'شکرالله',
  'gholamhossein': 'غلامحسین', 'gholamali': 'غلامعلی', 'mohammadali': 'محمدعلی', 'mohammadhosein': 'محمدحسین',
  'mohammadreza': 'محمدرضا', 'mohammadi': 'محمدی', 'hosseinali': 'حسین علی', 'alimohammad': 'علی محمد',
  'abedi': 'عابدی', 'ghaffar': 'غفار', 'safa': 'صفا', 'marzi': 'مرضی',
  // common given names (female)
  'zahra': 'زهرا', 'fatemeh': 'فاطمه', 'fatemah': 'فاطمه', 'maryam': 'مریم', 'sara': 'سارا', 'nazgol': 'نازگل',
  'mahnaz': 'ماه‌ناز', 'leila': 'لیلا', 'layla': 'لیلا', 'parvin': 'پروین', 'shirin': 'شیرین', 'mina': 'مینا',
  'niloofar': 'نیلوفر', 'niloufar': 'نیلوفر', 'roya': 'رویا', 'sima': 'سیما', 'somayeh': 'سمیه',
  'nasrin': 'نسرین', 'nasreen': 'نسرین', 'mahvash': 'مه‌وش', 'mahboubeh': 'محبوبه', 'marziyeh': 'مرضیه',
  'masoumeh': 'معصومه', 'mitra': 'میترا', 'mona': 'منا', 'nastaran': 'نسترن', 'narges': 'نرگس',
  'shohreh': 'شهره', 'soosan': 'سوسن', 'susan': 'سوسن', 'taraneh': 'ترانه', 'yeganeh': 'یگانه',
  'zeynab': 'زینب', 'zeinab': 'زینب', 'forough': 'فروغ', 'golnar': 'گلنار', 'golnaz': 'گلناز', 'goli': 'گلی',
  'hanieh': 'هانیه', 'hediyeh': 'هدیه', 'katayoun': 'کاتایون', 'khojasteh': 'خجسته', 'ladan': 'لادن',
  'nahid': 'ناهید', 'pari': 'پری', 'parichehr': 'پریچهر', 'parisa': 'پریسا', 'setareh': 'ستاره',
  'shabnam': 'شبنم', 'shahnaz': 'شهناز', 'shamsi': 'شمسی', 'sheida': 'شیدا', 'shideh': 'شیده',
  'farzaneh': 'فرزانه', 'mahsa': 'مهسا', 'neda': 'ندا', 'negin': 'نگین', 'sahar': 'سحر', 'sanaz': 'ساناز',
  // family-name suffixes / components
  'zadeh': 'زاده', 'zade': 'زاده', 'zadh': 'زاده', 'pour': 'پور', 'poor': 'پور', 'nejad': 'نژاد',
  'nejhad': 'نژاد', 'nia': 'نیا', 'fard': 'فرد', 'abadi': 'آبادی', 'abady': 'آبادی', 'khah': 'خواه',
  'yar': 'یار', 'dost': 'دوست', 'doost': 'دوست', 'kish': 'کیش', 'far': 'فر', 'mand': 'مند',
  'neshan': 'نشان', 'panah': 'پناه', 'shenas': 'شناس', 'vand': 'وند', 'khani': 'خانی', 'khel': 'خل',
  'ij': 'یج', 'bad': 'باد', 'nameh': 'نامه', 'zadh': 'زاده',
  // family names / surnames
  'ahmadi': 'احمدی', 'hosseini': 'حسینی', 'hoseini': 'حسینی', 'mousavi': 'موسوی', 'moosavi': 'موسوی',
  'rezaei': 'رضایی', 'rezaie': 'رضایی', 'rezai': 'رضایی', 'karimi': 'کریمی', 'moradi': 'مرادی',
  'mohammadi': 'محمدی', 'rahimi': 'رحیمی', 'hashemi': 'هاشمی', 'yazdani': 'یزدانی', 'jafari': 'جعفری',
  'jaafari': 'جعفری', 'abbasi': 'عباسی', 'dehghan': 'دهقان', 'dehghani': 'دهقانی', 'ghasemi': 'قاسمی',
  'ghassemi': 'قاسمی', 'nazari': 'نظری', 'sadeghi': 'صادقی', 'mahdavi': 'مهدوی', 'noori': 'نوری',
  'nouri': 'نوری', 'norouzi': 'نوروزی', 'noorouzi': 'نوروزی', 'amiri': 'امیری', 'jalali': 'جلالی',
  'kazemi': 'کاظمی', 'soltani': 'سلطانی', 'shirazi': 'شیرازی', 'esfahani': 'اصفهانی', 'isfahani': 'اصفهانی',
  'tabatabaei': 'طباطبایی', 'tabatabai': 'طباطبایی', 'alavi': 'علوی', 'tavakoli': 'توکلی',
  'tavakkoli': 'توکلی', 'emami': 'امامی', 'imami': 'امامی', 'sharifi': 'شریفی', 'bagheri': 'باقری',
  'bageri': 'باقری', 'gholami': 'غلامی', 'mashhadi': 'مشهدی', 'mashhadi': 'مشهدی', 'saberi': 'صابری',
  'safavi': 'صفوی', 'saffari': 'صفراری', 'salehi': 'صالحی', 'salahi': 'صلاحی', 'samadi': 'صمدی',
  'shahriari': 'شهریاری', 'taheri': 'طاهری', 'torabi': 'ترابی', 'ghorbani': 'قربانی', 'zolfaghari': 'زلفقری',
  'rostami': 'رستمی', 'rustami': 'رستمی', 'lotfi': 'لطیفی', 'mahmoudi': 'محمودی', 'monfared': 'منفرد',
  'nikpour': 'نیک‌پور', 'panahi': 'پناهی', 'ghanbari': 'قنبری', 'ramezani': 'رمضانی', 'ramazani': 'رمضانی',
  'rasouli': 'رسولی', 'sheikhi': 'شیخی', 'vahdati': 'وحدتی', 'zandi': 'زندی', 'zarei': 'زارعی',
  'zare': 'زارع', 'zeinali': 'زینالی', 'zeynali': 'زینالی', 'yazdi': 'یزدی', 'tehrani': 'تهرانی',
  'saeidi': 'سعیدی', 'saedi': 'سعیدی', 'sadiqi': 'صادقی', 'sanjar': 'سنجار', 'hamzeh': 'حمزه',
  'shohada': 'شهدا', 'rezae': 'رضایی', 'ahmar': 'احمر', 'ahmari': 'احمری', 'moein': 'معین',
  'saham': 'سهم', 'ghareh': 'قره', 'khoshdel': 'خوشدل', 'jaberi': 'جابری', 'farhang': 'فرهنگ',
  'siyahpoush': 'سیاه‌پوش', 'koliaei': 'کولیایی', 'makseri': 'مکسری', 'dashli': 'داشلی',
  'darvish': 'درویش', 'ilkhani': 'ایلخانی', 'ranjbari': 'رانجباری', 'ranjbar': 'رانجبر',
  'soleimani': 'سلیمانی', 'soleymani': 'سلیمانی', 'salmani': 'سلمانی', 'asadi': 'اسدی',
  'fazeli': 'فاضلی', 'fazle': 'فضل', 'zibaei': 'زیبایی', 'alijani': 'علیجانی', 'sherafati': 'شریفتی',
  'yasaman': 'یاسمن', 'ebrahimi': 'ابراهیمی', 'samandi': 'سامانی', 'khalkhal': 'خلخال', 'falak': 'فلک',
  'ayati': 'آیتی', 'sibeni': 'سیبنی', 'norouzi': 'نوروزی', 'vahdat': 'وحدت', 'mashhadi': 'مشهدی',
  'khorasani': 'خراسانی', 'gilani': 'گیلانی', 'mazandarani': 'مازندرانی', 'shirvani': 'شیروانی',
  'kashani': 'کاشانی', 'hamadani': 'همدانی', 'qazvini': 'قزوینی', 'tabrizi': 'تبرزی', 'kermani': 'کرمانی',
  'bandari': 'بندری', 'hormozi': 'هرمزی', 'khoei': 'خویی', 'golpayegani': 'گلپایگانی', 'najafabadi': 'نجف‌آبادی',
  'jahromi': 'جهرمی', 'ahmadi': 'احمدی', 'sabzevari': 'سبزواری', 'broujerdi': 'بروجردی', 'boroujerdi': 'بروجردی',
  'semnani': 'سمنانی', 'sistani': 'سیستانی', 'baloch': 'بلوچ', 'baluch': 'بلوچ', 'lor': 'لر', 'kurd': 'کرد',
  'farsi': 'فارسی', 'parsa': 'پارسا', 'rad': 'راد', 'radan': 'رادان', 'bahadori': 'بهادری', 'bahador': 'بهادر',
  'alizadeh': 'علیزاده', 'hoseinzadeh': 'حسین‌زاده', 'hosseinzadeh': 'حسین‌زاده', 'mohammadzadeh': 'محمدزاده',
  'rezazadeh': 'رضازاده', 'alizade': 'علیزاده', 'mahdizadeh': 'مهدی‌زاده', 'gholizadeh': 'قلی‌زاده',
  'soltanzadeh': 'سلطان‌زاده', 'khanzadeh': 'خان‌زاده', 'beigzadeh': 'بیگ‌زاده', 'marzban': 'مرزبان',
  'kaviani': 'کاویانی', 'afshari': 'افشاری', 'afshar': 'افشار', 'bakhtiari': 'بختیاری', 'lori': 'لری',
  'ghashghaei': 'قشقایی', 'ghashghai': 'قشقایی', 'savoji': 'ساوجی', 'savadi': 'ساودی',
  // corporate / organizational tokens
  'family': 'خانواده', 'thoroughbreds': 'تروبرد', 'thoroughbred': 'تروبرد', 'stud': 'اصطبل',
  'equestrian': 'سوارکاری', 'club': 'باشگاه', 'farm': 'مزرعه', 'stables': 'اصطبل‌ها', 'stable': 'اصطبل',
  'company': 'شرکت', 'co': 'شرکت', 'corp': 'شرکت', 'center': 'مرکز', 'centre': 'مرکز',
  'international': 'بین‌المللی', 'national': 'ملی', 'agriculture': 'کشاورزی', 'ministry': 'وزارت',
  'organization': 'سازمان', 'organisation': 'سازمان', 'veterinary': 'دامپزشکی', 'university': 'دانشگاه',
  'institute': 'مؤسسه', 'academy': 'آکادمی', 'association': 'انجمن', 'group': 'گروه', 'holding': 'هلدینگ',
  'brothers': 'برادران', 'sons': 'پسران', 'breeding': 'پرورش', 'complex': 'مجتمع', 'sport': 'ورزشی',
  'sports': 'ورزشی', 'pony': 'پونی', 'arab': 'عرب', 'arabian': 'عرب', 'arabians': 'عربیان', 'horse': 'هاس',
  'horses': 'هاس', 'racing': 'راسینگ', 'ranch': 'رانچ', 'ltd': 'محدود', 'llc': 'محدود', 'inc': 'شرکت',
  'agri': 'اگری', 'lab': 'آزمایشگاه', 'laboratory': 'آزمایشگاه', 'clinic': 'کلینیک', 'hospital': 'بیمارستان',
  // places
  'tehran': 'تهران', 'mashhad': 'مشهد', 'mashad': 'مشهد', 'isfahan': 'اصفهان', 'esfahan': 'اصفهان',
  'tabriz': 'تبریز', 'shiraz': 'شیراز', 'ahvaz': 'اهواز', 'qom': 'قم', 'karaj': 'کرج', 'urmia': 'ارومیه',
  'rasht': 'رشت', 'kerman': 'کرمان', 'yazd': 'یزد', 'hamadan': 'همدان', 'hamedan': 'همدان',
  'kermanshah': 'کرمانشاه', 'zanjan': 'زنجان', 'sanandaj': 'سنندج', 'khorramabad': 'خرم‌آباد',
  'gorgan': 'گرگان', 'sari': 'ساری', 'bam': 'بم', 'gonbad': 'گنبد', 'sabzevar': 'سبزوار',
  'najafabad': 'نجف‌آباد', 'varamin': 'ورامین', 'qazvin': 'قزوین', 'kashan': 'کاشان', 'borujerd': 'بروجرد',
  'dehdasht': 'دهدشت', 'dashti': 'دشتی', 'dashtestan': 'دشتستان', 'shushtar': 'شوشتر', 'dezful': 'دزفول',
  ' Beheshti': 'بهشتی',
  // misc connectors
  'va': 'و', 'be': 'به', 'bar': 'بار', 'abad': 'آباد', 'est': 'است',
};

// R159 corrections (audited against live token frequencies 2026-10-30):
// real-spelling fixes for fallback outputs the R158 audit proved wrong, plus
// coverage for the most frequent still-unknown tokens. Wins over the base D.
Object.assign(D, {
  // shahr- family (user-reported: شهرزاد NOT شاهرزاد)
  'shahrzad': 'شهرزاد', 'shahr': 'شهر', 'shahrooz': 'شهروز', 'shahrouz': 'شهروز',
  'shahrbano': 'شهربانو', 'shahrbanou': 'شهربانو',
  // dict corrections (were wrong in R158)
  'horse': 'هورس', 'horses': 'هورس', 'sanjar': 'سنجر', 'ranjbar': 'رنجبر',
  'ranjbari': 'رنجبری', 'mahvash': 'مهوش', 'moharram': 'محرم', 'muharram': 'محرم',
  'saffari': 'صفری', 'zeynol': 'زین‌ال', 'zeynolabedin': 'زین‌العابدین',
  'zeinolabedin': 'زین‌العابدین', 'hosseinali': 'حسین‌علی',
  // high-frequency fallback fixes (silent-h / ع-ح / vowel errors)
  'gholi': 'قلی', 'heidar': 'حیدر', 'heidari': 'حیدری', 'heydar': 'حیدر', 'heydari': 'حیدری',
  'morad': 'مراد', 'rahim': 'رحیم', 'rahmani': 'رحمانی', 'rahmati': 'رحمتی',
  'haji': 'حاجی', 'haj': 'حاج', 'jaafar': 'جعفر', 'jafar': 'جعفر',
  'berdi': 'بردی', 'dinn': 'دین', 'fallah': 'فلاح', 'saleh': 'صالح',
  'behrouz': 'بهروز', 'behrooz': 'بهروز', 'bahman': 'بهمن', 'jalil': 'جلیل',
  'esmaeili': 'اسماعیلی', 'moghaddam': 'مقدم', 'moghadam': 'مقدم',
  'hassani': 'حسانی', 'kamal': 'کمال', 'kamali': 'کمالی', 'aziz': 'عزیز',
  'azizi': 'عزیزی', 'azim': 'عظیم', 'azimi': 'عظیمی', 'najafi': 'نجفی',
  'jamal': 'جمال', 'jamali': 'جمالی', 'nasab': 'نسب', 'shahab': 'شهاب',
  'khalil': 'خلیل', 'khalili': 'خلیلی', 'assadi': 'اسدی', 'ardakani': 'اردکانی',
  'moslem': 'مسلم', 'adel': 'عادل', 'abol': 'ابوال', 'mehr': 'مهر', 'mehrani': 'مهرانی',
  'younes': 'یونس', 'seyedi': 'سیدی', 'hakim': 'حکیم', 'hakimi': 'حکیمی',
  'mansouri': 'منصوری', 'asgari': 'عسگری', 'asgar': 'عسگر', 'rajab': 'رجب',
  'rajabi': 'رجابی', 'mr': 'آقا', 'mrs': 'خانم', 'kord': 'کرد', 'kordi': 'کردی',
  'dehkordi': 'دهکردی', 'ghafour': 'غفور', 'ghafoor': 'غفور', 'yaser': 'یاسر',
  'ashour': 'آشور', 'asl': 'اصل', 'shams': 'شمس', 'eslami': 'اسلامی',
  'karami': 'کرمی', 'yaaghoub': 'یعقوب', 'yousefi': 'یوسفی', 'yusofi': 'یوسفی',
  'farshad': 'فرشاد', 'farshid': 'فرشید', 'ashkezari': 'اشکذری', 'maleki': 'ملکی',
  'hesam': 'حسام', 'hesami': 'حسامی', 'bahrami': 'بهرامی', 'issa': 'عیسی',
  'manesh': 'منش', 'khosravi': 'خسروی', 'khoda': 'خدا', 'ghelich': 'قلیچ',
  'ghelichi': 'قلیچی', 'manouchehr': 'منوچهر', 'vahab': 'وهاب', 'babai': 'بابایی',
  'babaei': 'بابایی', 'saadi': 'سعدی', 'gol': 'گل', 'nazar': 'نظر', 'hojat': 'حجت',
  'salman': 'سلمان', 'nasseri': 'ناصری', 'sharif': 'شریف', 'rafiei': 'رفیعی',
  'ghezel': 'قزل', 'khosrow': 'خسرو', 'khosro': 'خسرو', 'talebi': 'طالبی',
  'khajeh': 'خواجه', 'erfan': 'عرفان', 'soleiman': 'سلیمان', 'matin': 'متین',
  'fathi': 'فتحی', 'abdollahi': 'عبداللهی', 'safar': 'صفر', 'nemati': 'نعمتی',
  'movahed': 'موحد', 'dolat': 'دولت', 'dolati': 'دولتی', 'aref': 'عارف',
  'hatami': 'حاتمی', 'elham': 'الهام', 'salim': 'سلیم', 'zargani': 'زرگانی',
  'jaber': 'جابر', 'jabbar': 'جبار', 'farid': 'فرید', 'shafiei': 'شفیعی',
  'molla': 'ملا', 'sajadi': 'سجادی', 'zanganeh': 'زنگنه', 'kouchaki': 'کوچکی',
  'aram': 'آرام', 'taha': 'طاها', 'azar': 'آذر', 'mokhtari': 'مختاری',
  'bayat': 'بیات', 'salimi': 'سلیمی', 'payam': 'پیام', 'kargar': 'کارگر',
  'arsalan': 'ارسلان', 'eskandari': 'اسکندری', 'sorkheh': 'سرخه', 'naderi': 'نادری',
  'nabi': 'نبی', 'shakeri': 'شاکری', 'benyamin': 'بنیامین', 'fattahi': 'فتاحی',
  'ghaffari': 'غفاری', 'mirzae': 'میرزایی', 'mirzaei': 'میرزایی', 'bakhsh': 'بخش',
  'saber': 'صابر', 'raad': 'رعد', 'kassir': 'کسیر', 'izad': 'ایزد', 'izadi': 'ایزدی',
  'safari': 'سفاری', 'jorjani': 'جرجانی', 'ana': 'آنا', 'ata': 'عطا', 'araz': 'آراز',
  'hamidi': 'حمیدی', 'mohseni': 'محسنی', 'nafas': 'نفس', 'sahand': 'سهند',
  'hormoz': 'هرمز', 'bahr': 'بحر', 'bahrani': 'بحرانی', 'malekzadeh': 'ملک‌زاده',
  'alipour': 'علی‌پور', 'rezapour': 'رضاپور', 'mohammadpour': 'محمدپور',
  'hosseinpour': 'حسین‌پور', 'hoseinpour': 'حسین‌پور', 'mahdipour': 'مهدی‌پور',
  'ahmadzadeh': 'احمدزاده', 'hojati': 'حجتی', 'essa': 'عیسی', 'zaher': 'زاهر',
  'zahir': 'ظاهر', 'zahiri': 'ظاهری', 'zohreh': 'زهره',
});

// ordered multigraph rules (longest first) for the fallback transliterator
// R159: 'ahr'/'ehr' — the city word شهر (shahr) and بهروز/شهرزاد family were
// rendered with a spurious ه (شاهرزاد/بههروز); vowel+h before r is silent there.
const GRAPHEMES = [
  ['ahr', 'هر'], ['ehr', 'هر'],
  ['ough', 'اُف'], ['augh', 'اف'],
  ['iya', 'یا'], ['aya', 'ایا'], ['iye', 'یه'], ['aye', 'ایه'], ['ya', 'یا'], ['ang', 'نگ'], ['eyh', 'یح'], ['ayh', 'یح'],
  ['sch', 'ش'], ['tch', 'چ'],
  ['kh', 'خ'], ['gh', 'غ'], ['sh', 'ش'], ['ch', 'چ'], ['zh', 'ژ'], ['th', 'ث'], ['ph', 'ف'],
  ['ck', 'ک'], ['qu', 'کو'], ['kn', 'ن'], ['wr', 'ر'], ['ps', 'س'],
  ['sch', 'ش'],
  ['oo', 'و'], ['ou', 'و'], ['ow', 'و'], ['ee', 'ی'], ['ei', 'ی'], ['ey', 'ی'], ['ay', 'ای'],
  ['ai', 'ای'], ['aa', 'ا'], ['ae', 'ا'], ['oe', 'و'], ['ue', 'و'], ['ie', 'ی'], ['eu', 'یو'],
  ['au', 'او'],
  ['a', 'ا'], ['b', 'ب'], ['c', 'ک'], ['d', 'د'], ['e', 'ه'], ['f', 'ف'], ['g', 'گ'], ['h', 'ه'],
  ['i', 'ی'], ['j', 'ج'], ['k', 'ک'], ['l', 'ل'], ['m', 'م'], ['n', 'ن'], ['o', 'و'], ['p', 'پ'],
  ['q', 'ق'], ['r', 'ر'], ['s', 'س'], ['t', 'ت'], ['u', 'و'], ['v', 'و'], ['w', 'و'], ['x', 'کس'],
  ['y', 'ی'], ['z', 'ز'],
];

const SINGLE = new Map([['a', 'ا'], ['b', 'ب'], ['c', 'ک'], ['d', 'د'], ['e', 'ه'], ['f', 'ف'],
  ['g', 'گ'], ['h', 'ه'], ['i', 'ی'], ['j', 'ج'], ['k', 'ک'], ['l', 'ل'], ['m', 'م'], ['n', 'ن'],
  ['o', 'و'], ['p', 'پ'], ['q', 'ق'], ['r', 'ر'], ['s', 'س'], ['t', 'ت'], ['u', 'و'], ['v', 'و'],
  ['w', 'و'], ['x', 'کس'], ['y', 'ی'], ['z', 'ز']]);

function fallbackToken(word) {
  let w = word.toLowerCase();
  // dotted abbreviations: "J.C" -> per-letter transliteration joined by dots
  if (w.includes('.') && w.split('.').every((part) => part.length <= 2)) {
    return w.split('.').filter(Boolean).map((part) => fallbackToken(part)).join('.');
  }
  // strip non-letter chars but keep them as boundaries
  const leading = w.match(/^[^a-z]*/)[0];
  const trailing = w.match(/[^a-z]*$/)[0];
  const core = w.slice(leading.length, w.length - trailing.length);
  if (!core) return word;
  // word-final 'ei' -> یی
  if (core.endsWith('ei') && core.length > 2) {
    return leading + fallbackToken(core.slice(0, -2)).replace(/^[^\u0600-\u06FF]*/, '') + 'یی' + trailing;
  }
  let out = '';
  for (let i = 0; i < core.length; i++) {
    const rest = core.slice(i);
    let matched = false;
    for (const [g, fa] of GRAPHEMES) {
      if (rest.startsWith(g)) {
        // 'e' at word end -> ه ; 'i' at word end -> ی ; 'a' at word end -> ه
        out += fa;
        i += g.length - 1;
        matched = true;
        break;
      }
    }
    if (!matched) out += '';
  }
  // final-vowel corrections: Persian words end with ه/ی/و not هه/اه typically
  out = out
    .replace(/اهه$/, 'اه')
    .replace(/هه$/, 'ه')
    .replace(/یه$/, 'یه')
    .replace(/وی$/, 'وی');
  // initial vowel shaping
  if (out.startsWith('و') && /^o|^u/.test(core)) out = 'ا' + out;
  if (out.startsWith('ی') && /^i/.test(core)) out = 'ا' + out;
  // word-final 'ei' renders as یی (Koliaei -> کولیایی)
  return leading + out + trailing;
}

function translitToken(token) {
  const lower = token.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(D, lower)) return D[lower];
  // try stripping trailing dot for dictionary hits like "s."
  if (lower.endsWith('.') && Object.prototype.hasOwnProperty.call(D, lower.slice(0, -1))) {
    return D[lower.slice(0, -1)] + '.';
  }
  // already non-Latin? keep as-is
  if (!/[a-z]/i.test(token)) return token;
  // single latin letter (initials) -> keep letter as-is (transliteration of "S." etc. handled above)
  if (token.length === 1) return SINGLE.get(lower) ?? token;
  return fallbackToken(token);
}

/** Transliterate a full Latin name into Farsi. */
export function toFarsi(name) {
  if (!name) return '';
  if (/[\u0600-\u06FF]/.test(name)) return name; // already Persian
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map(translitToken)
    .join(' ')
    .trim();
}
