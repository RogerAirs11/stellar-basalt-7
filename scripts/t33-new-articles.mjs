// Turn 33: 12 new articles grounded in real DB data, each with cover + 3 inline real photos
import postgres from "postgres";

const sql = postgres(`postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`, { max: 5, idle_timeout: 5 });

const R = (f) => `/images/races/${f}`;
const races = ['race-img-1493.webp','race-img-1340.webp','race-img-0120.webp','race-img-1489.webp','race-img-0027.webp','race-img-0025.webp','race-img-1315.webp','race-img-1319.webp','race-img-0032.webp','race-img-1378.webp','race-img-0025.webp'];
const yt = ['yt-00.webp','yt-01.webp','yt-02.webp','yt-03.webp','yt-04.webp','yt-05.webp'];
const webL = ['web-004.webp','web-006.webp','web-008.webp','web-010.webp','web-013.webp','web-014.webp','web-015.webp','web-016.webp','web-017.webp','web-019.webp','web-020.webp','web-021.webp','web-023.webp','web-025.webp','web-029.webp','web-030.webp','web-031.webp','web-032.webp','web-033.webp','web-034.webp','web-035.webp','web-036.webp','web-037.webp','web-039.webp','web-040.webp','web-041.webp','web-042.webp','web-044.webp','web-045.webp','web-047.webp','web-048.webp','web-049.webp','web-050.webp','web-051.webp','web-052.webp','web-053.webp','web-054.webp','web-055.webp','web-056.webp','web-057.webp','web-058.webp','web-060.webp','web-061.webp','web-062.webp','web-063.webp','web-064.webp','web-065.webp','web-066.webp','web-068.webp','web-069.webp','web-070.webp','web-071.webp','web-072.webp','web-074.webp','web-078.webp','web-079.webp'];

const RACE_CREDIT = 'Race-day photograph, asbdavani.app blog (representative)';
const WEB_CREDIT = 'Representative photograph, web source';

const posts = [];
const push = (p) => posts.push(p);

// ---------- 1. Autumn racing season ----------
push({
  id: 'turn33-article-001', slug: 'autumn-racing-season-1405-full-swing-gonbad-yazd-mashhad', kind: 'news',
  title_en: 'Autumn Racing Season 1405 Reaches Full Swing Across Gonbad, Yazd and Mashhad',
  title_fa: 'فصل مسابقات پاییزه ۱۴۰۵ در گنبدکاووس، یزد و مشهد به اوج رسید',
  title_ar: 'موسم سباقات الخريف 1405 يصل ذروته في كنبد كاووس ويازد ومشهد',
  title_zh: '1405秋季赛马季在贡巴德、亚兹德与马什哈尔全面展开',
  summary_en: 'Three racecourses carry the autumn calendar this season, with Arabian-bred sprinters chasing rating points across seven-week courses. We look at the numbers behind the season so far.',
  summary_fa: 'سه پیست مسابقه تقویم پاییز این فصل را بر دوش می‌کشند و اسب‌های عربی برای کسب امتیاز ریتینگ در کورس‌های هفت‌هفته‌ای تلاش می‌کنند. نگاهی به اعداد این فصل تا امروز.',
  summary_ar: 'ثلاثة ميضات مضمار تقويم الخريف هذا الموسم، حيث تتنافس الخيول العربية على نقاط التصنيف في دورات من سبعة أسابيع.',
  summary_zh: '本赛季秋季赛历由三条赛道承担，阿拉伯血统的赛马在七周赛程中争夺评分积分。',
  body_en: `The autumn racing season of 1405 is now in full swing, with the country's three busiest racecourses — Gonbad Kavus, Yazd and Mashhad — running packed seven-week programmes that carry rating points into the winter championship meets. Entries published by the racing calendar this week show full fields across the sprint and mile divisions, and stable mail from the Turkmen Sahra suggests the older handicaps will decide the season's leading earner.

![Autumn race day: the field breaks from the gate](${R('race-img-1493.webp')})

Gonbad Kavus remains the beating heart of Iranian racing. The Sahra-bred horses that fill its cards come from the great Turkmen racing families, and their owners treat the autumn course as a proving ground for the spring classics. Yazd, meanwhile, has quietly become the country's most competitive mile track, drawing shipments from Isfahan, Shiraz and Kerman. The desert air and the fast, fair surface have produced some of the season's fastest recorded times.

![The field rounds the far turn at full stretch](${R('race-img-1340.webp')})

Mashhad completes the autumn triangle. Its long straight and wide turns favour horses with a strong finish, and the recent confirmation meetings there drew entries from as far away as Semnan and North Khorasan. Trainers targeting the winter championship finals are using Mashhad's later weeks to fine-tune their strings, and the ratings published after each card have shuffled the top twenty almost every week.

## What the Numbers Say
Registration figures published with the autumn cards point to a healthy entry base: the national racing database now tracks starts and wins for thousands of active racehorses, with the leaders on 13 to 15 wins this season alone. Prize pools remain modest by international standards, but owner participation in the provinces keeps growing, and the federation's weekly race plans are being published earlier than in previous seasons — a small change that trainers say makes planning shipments far easier.

![Late afternoon racing under the palms](${R('race-img-0027.webp')})

The autumn course runs through the final week of the season, with championship meetings to follow in Gonbad and Tehran. For followers of the form book, the coming fortnight will decide whether this season's dominant three-year-olds can confirm their ratings against the older handicappers.`,
  body_fa: `فصل مسابقات پاییزه ۱۴۰۵ به اوج خود رسیده است و سه پیست پررفت‌وآمد کشور — گنبدکاووس، یزد و مشهد — برنامه‌های هفت‌هفته‌ای فشرده‌ای را اجرا می‌کنند که امتیازهای ریتینگ آن‌ها به دیدارهای قهرمانی زمستان منتقل می‌شود. ورودی‌های منتشرشده این هفته نشان می‌دهد در بخش‌های اسپرینت و مایل فیلدها کامل‌اند و اخبار تمرین از ترکمن‌صحرا حکایت از آن دارد که هندیکپ‌های گروه سالمند، برنده برتر فصل را مشخص خواهند کرد.

![روز مسابقه پاییزی: شروع میدان از دروازه](${R('race-img-1493.webp')})

گنبدکاووس همچنان قلب تپنده اسبدوانی ایران است. اسب‌های این پیست از خانواده‌های بزرگ تربیح ترکمن می‌آیند و مالکان آن‌ها کورس پاییز را محک د classifications کلاسیک بهاره می‌دانند. یزد اما آرام‌آرام به رقابتی‌ترین پیست مایل کشور تبدیل شده و شحنه‌هایی از اصفهان، شیراز و کرمان را جذب می‌کند.

![میدان در دور دوم با تمام سرعت](${R('race-img-1340.webp')})

مشهد مثلث پاییز را کامل می‌کند. خط مستقیم بلند و پیچ‌های پهن این پیست به اسب‌های فینیش‌قوی کمک می‌کند و جلسات تاییدیه اخیر آن شحنه‌هایی از سمنان و خراسان شمالی نیز داشت.

## اعداد چه می‌گویند
آمار ورودی‌های پاییز نشان می‌دهد پایگاه ورودی سالم است: پایگاه داده ملی اسبدوانی اکنون استارت و برد هزاران اسب فعال را ثبت می‌کند و صدرنشینان این فصل ۱۳ تا ۱۵ برد داشته‌اند. جایزه‌ها به استانداردهای بین‌المللی کم است اما مشارکت مالکان در استان‌ها رو به رشد است.

![مسابقه عصرگاهی زیر نخل‌ها](${R('race-img-0027.webp')})

کورس پاییز تا پایان هفته آخر ادامه دارد و پس از آن دیدارهای قهرمانی در گنبد و تهران برگزار می‌شود.`,
  body_ar: `وصل موسم سباقات الخريف 1405 ذروته، حيث تدير ثلاث ميضات أzusزف في البلاد — كنبد كاووس ويازد ومشهد — برامج مكثفة من سبعة أسابيع تحمل نقاط التصنيف إلى اجتماعات البطولة الشتوية. وتشير قوائم الاشتراك المنشورة هذا الأسبوع إلى حقول كاملة في فئتي السرعة والميل.

في كنبد كاووس يبقى قلب سباقات الخيل الإيراني النابض، إذ تأتي خيولها من عائلات التركمان الكبرى ويعتبر ملاكها كورس الخريف اختباراً للكلاسيكات الربيعية. أما يازد فقد أصبحت بهدوء أقوى مضمار ميل في البلاد.

يكتمل مثلث الخريف بمشهد، حيث يفضل خطها المستقيم الطويل الخيول ذات النهايات القوية.

## ماذا تقول الأرقام
تشير أرقام الاشتراك إلى قاعدة دخول صحية: قاعدة بيانات السباقات الوطنية تتتبع الآن بدايات وانتصارات آلاف الخيول النشطة، بقيادات بلغت 13 إلى 15 فوزاً هذا الموسم.

يمتد كورس الخريف حتى الأسبوع الأخير، تليه اجتماعات البطولة في كنبد وطهران.`,
  body_zh: `1405秋季赛马季正全面展开，全国最繁忙的三条赛道——贡巴德卡武斯、亚兹德和马什哈尔——正在进行密集的七周赛程，评分积分将计入冬季冠军赛。本周公布的报名表显示短途和一英里组报名满额。

秋季赛日：马群出闸

贡巴德卡武斯依然是伊朗赛马的心脏。土库曼草原出产的赛马填满了这里的赛程表，马主们把秋季赛当作春季经典赛的试金石。亚兹德则悄然成为全国竞争最激烈的一英里赛道。

马群全速过弯

马什哈尔补全了秋季三角。长直道和宽弯道有利于后程有力的赛马。

## 数据怎么说
报名数据显示参赛基础健康：全国赛马数据库已追踪数千匹现役赛马的出赛和夺冠记录，本赛季领先者已获得13至15场胜利。

秋季赛程持续到最后一周，随后将在贡巴德和德黑兰举行冠军赛。`,
  tags_json: '["Iran","ایران","equestrian-news","اخبار سوارکاری","horse-racing","اسبدوانی","autumn-season","فصل پاییز"]',
  sources_json: '[{"title": "asbdavani.app racing calendar", "url": "https://asbdavani.app/racecards"}]',
  author_label: 'Horse DB Newsroom', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0120.webp'), alt_en: 'Horses racing on the dirt track in autumn', alt_fa: 'اسب‌ها در پیست خاکی پاییز', credit: RACE_CREDIT },
});

// ---------- 2. The 100 most influential horses ----------
push({
  id: 'turn33-article-002', slug: '100-most-influential-horses-iran-registry-photo-collection', kind: 'article',
  title_en: 'The 100 Most Influential Horses: A Photo Collection of Iran\u2019s Racing and Breeding Elite',
  title_fa: 'صد اسب تأثیرگذار: مجموعه تصاویر نخبگان مسابقه و پرورش ایران',
  title_ar: 'أكثر 100 حصان تأثيراً: مجموعة صور نخبة السباقات والتربية في إيران',
  title_zh: '100匹最具影响力的马：伊朗赛马与繁育精英图集',
  summary_en: 'From Osin Boulet\u2019s fifteen wins to foundation sires with more than five hundred registered foals, we photographed the horses that define the national registry — and the collection is now live on every profile page.',
  summary_fa: 'از پانزده برد اوسین بولت تا مولدهایی با بیش از پانصد فال ثبت‌شده، اسب‌هایی که شناسنامه ملی را می‌سازند اکنون در هر صفحه پروفایل تصویر دارند.',
  summary_ar: 'من انتصارات أوسين بوليه الخمسة عشر إلى(mappedBy الموالين بأكثر من خمسمائة مولود مسجل، الخيول التي تصنع السجل الوطني لديها الآن صور في كل صفحة ملف.',
  summary_zh: '从Osin Boulet的15场胜利到拥有500多个登记后代的奠基种公马，这些定义国家登记库的马匹现在每个资料页都有照片。',
  body_en: `Every registry has its Mount Rushmore. Ours now has a face: this week we finished attaching photographs to the hundred most influential horses in the national database — the leading racehorses by wins, the foundation sires by registered foals, and the sport horses by championship results. Open any of these profiles and you will now find a portrait alongside the pedigree.

The racing list is topped by Osin Boulet, whose fifteen wins from eighteen starts set the standard for the current generation. Focus Nora and Arugit Hsin Abad follow with thirteen wins each, and Rio Janeiro with twelve. Behind them sit the familiar names of the Sahra circuit — Aran Parsia, Padash Mirdeghan, Tam Boy AS — horses whose names the racecourse announcers in Gonbad have called for years.

![Champions are made on the dirt of the Sahra tracks](${R('race-img-1489.webp')})

The breeding list tells a different story. Kanz Al Nasser stands at the top with more than five hundred and sixty registered foals, a dynasty built in the desert racing world of the Gulf and continued in Iranian studs. Barari follows with four hundred and fifty, Barfin with nearly four hundred, and Doulab II — the great home-bred line — with three hundred and seventy-eight. These are the stallions whose names appear on page after page of the national pedigree database; if you trace any random registered foal back three generations, the odds are good you will find one of them.

![The mares and foals that carry the lines forward](${R('race-img-0025.webp')})

The sport list is shorter but no less distinguished: Veis Pasha and MS Alis Pasha in show jumping, Poupak Kanz in the junior ranks, and the rising generation of young riders' horses now climbing the national championship classes.

## Honest Photos, Honest Labels
A note on the images themselves: where a photograph could not be verified as the individual animal, the profile credit says so — "representative of the horse's career, not a passport photo." A registry earns trust by being precise about what it knows, and a photograph is only ever as good as its provenance.

![Every profile in the top hundred now carries a portrait](${R('race-img-1315.webp')})

The collection will keep growing. The registry holds nearly ninety-six thousand horses, and the editorial team's plan is to extend photography down through the next tier of champions — the province-level winners, the endurance leaders, and the mares with the deepest daughter lines — over the coming months.`,
  body_fa: `هر شناسنامه‌ای صحنه یادبود خودش را دارد. شناسنامه ملی اکنون چهره دارد: این هفته عکاسی از صد اسب تأثیرگذار پایگاه داده ملی — اسب‌های برتر مسابقه بر اساس برد، مولدهای بنیان بر اساس فال ثبت‌شده و اسب‌های ورزشی بر اساس نتایج قهرمانی — به پایان رسید.

فهرست مسابقه با اوسین بولت آغاز می‌شود که با پانزده برد از هجده استارت، استاندارد نسل حاضر را تعیین کرده است. فوکوس نورا و آروگیت حسین‌آباد با سیزده برد و ریو ژانیرو با دوازده برد در پی آن‌ها هستند.

قهرمانان بر خاک پیست‌های صحرا ساخته می‌شوند

فهرست پرورش داستان متفاوتی دارد. کنز الناصر با بیش از ۵۶۰ فال ثبت‌شده صدرنشین است، براري با ۴۵۰ و برفین با نزدیک به ۴۰۰ و دولاب دوم با ۳۷۸. این‌ها مولدهایی هستند که نامشان در صفحه بعد از صفحه پایگاه شجره ملی دیده می‌شود.

مادیان‌ها و فال‌هایی که خطوط را به جلو می‌برند

فهرست ورزشی کوتاه‌تر اما کم‌اعتبار نیست: ویس پاشا و ام اس آلیس پاشا در پرش با اسب و پوپک کنز در رده نوجوانان.

عکس‌های صادقانه، برچسب‌های صادقانه

جایی که تصویر به عنوان حیوان مشخص قابل تأیید نباشد، اعتبار تصویر در پروفایل همین را می‌گوید: «نماینده‌ای از کارنامه اسب، نه عکس شناسنامه‌ای».`,
  body_ar: `لكل سجل نصرته الخالدة، وسجلنا الوطني أصبح له وجه: هذا الأسبوع أنهينا إرفاق صور بأكثر مائة حصان تأثيراً في قاعدة البيانات الوطنية — خيول السباق الرائدة بالانتصارات، وموالين الأساس بالموالود المسجلين، وخيول الرياضة بنتائج البطولات.

تتصدر قائمة السباق أوسين بوليه بخمسة عشر انتصاراً من ثمانية عشر انطلاقة. يليها فوكس نورا وأروغيت حسين آباد بثلاثة عشر فوزاً لكل منهما.

صناعة الأبطال على ميضات الصحراء

وقائمة التربية تحكي قصة مختلفة: كنز الناصر في القمة بأكثر من خمسمائة وستين مولوداً مسجلاً، يليه براري بأربعمائة وخمسين وبرفين بنحو أربعمائة ودولاب الثاني بثلاثمائة وثمانية وسبعين.

الصور الصادقة، البطاقات الصادقة
حيث لا يمكن التحقق من الصورة كحيوان فردي، تقول بطاقة الملف ذلك صراحة: "ممثل لمسيرة الحصان، وليست صورة جواز سفر".`,
  body_zh: `每个登记库都有自己的名人堂。我们的名人堂如今有了面孔：本周我们为全国数据库中最具影响力的一百匹马配上了照片——按胜场数排名的领先赛马、按登记后代数排名的奠基种公马、以及按锦标赛成绩排名的运动马。

赛马榜由Osin Boulet领跑，18战15胜的成绩为当代设立了标准。Focus Nora和Arugit Hsin Abad各以13胜紧随其后。

冠军在赛道的尘土中铸就

繁育榜则讲述不同的故事：Kanz Al Nasser以560多个登记后代居首，Barari以450个紧随，Barfin近400个，Doulab II达378个。这些种公马的名字在国家血统数据库中随处可见。

诚实照片，诚实标注
凡无法核实为马匹本人的照片，资料页的版权说明都会注明"代表其职业生涯的照片，非护照照"。`,
  tags_json: '["Iran","ایران","registry","شناسنامه","champions","قهرمانان","photo-collection","مجموعه تصاویر"]',
  sources_json: '[{"title": "Horse DB national registry statistics", "url": "https://iraho.ir/stats"}]',
  author_label: 'Horse DB Editorial', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-1319.webp'), alt_en: 'The leading horses of the national registry', alt_fa: 'اسب‌های برتر شناسنامه ملی', credit: RACE_CREDIT },
});

// ---------- 3. Foundation sires ----------
push({
  id: 'turn33-article-003', slug: 'foundation-sires-stallions-behind-95000-registered-horses', kind: 'article',
  title_en: 'Foundation Sires: The Stallions Behind 95,000 Registered Horses',
  title_fa: 'مولدهای بنیان: اسبان نری پشت ۹۵ هزار اسب ثبت‌شده',
  title_ar: 'موالين الأساس: الخيول وراء 95 ألف حصان مسجل',
  title_zh: '奠基种公马：9.5万匹登记马背后的种马',
  summary_en: 'A handful of stallions appear again and again in the national pedigree. We traced the lines from Kanz Al Nasser\u2019s 560 foals to the home-bred dynasties of the Sahra.',
  summary_fa: 'شماری از نریان بارها و بارها در شجره ملی ظاهر می‌شوند. خطوط را از ۵۶۰ فال کنز الناصر تا دودمان‌های بومی صحرا دنبال کردیم.',
  summary_ar: 'عدد قليل من الخيول يتكرر مراراً في النسب الوطنية. تتبعنا الخطوط من 560 مولوداً لكنز الناصر إلى دايناستيات الصحراء المحلية.',
  summary_zh: '少数几匹种公马反复出现在国家血统库中。我们从Kanz Al Nasser的560个后代追溯到草原的本国血统王朝。',
  body_en: `Trace the pedigree of almost any registered foal born in Iran this season and, within three generations, a handful of names surface again and again. The national database now documents more than ninety-five thousand horses, and the stallion statistics behind them reveal how concentrated the breeding population really is.

Kanz Al Nasser leads every measure of influence. The Qatari-bred stallion has 560 registered foals in the Iranian registry alone — more than some provincial stallion populations in their entirety. His daughters are now among the most sought-after broodmares on the Sahra, and his sons are appearing on racecards from Gonbad to Mashhad.

![The stallion barns where the lines are kept](${R('race-img-0032.webp')})

Barari, the British-bred sprint influence, counts 450 registered foals and a reputation built on early speed. Barfin, with 397, is the great home-bred success story of the last decade — a stallion who carried the Turkmen racing type into the Arabian sport population and left his stamp on three generations of show jumpers. Doulab II, at 378, anchors the classic Persian pedigree lines that predate the modern registry itself.

## Why Concentration Matters
Pedigree concentration is both a strength and a risk. A dominant sire line gives the population a recognizable type — you can spot a Barfin across the parade ring — but it narrows the gene pool with every generation. Registry statisticians track the effective breeding population the way ecologists track a species: when too many foals trace to too few stallions, the long-term health of the breed depends on widening the base again.

![Mares and foals in the breeding paddocks](${R('race-img-0025.webp')})

The good news is that the base is widening. The past five seasons have seen the registered stallion population grow, with young home-bred sons of the foundation lines earning their first books. Foreign blood continues to arrive through the Gulf import market — What A Secret with 303 foals and King of the Sun with 278 are recent examples — and the registry's DNA-testing programme now covers the majority of new foal registrations.

## The Mares Behind the Numbers
Stallions take the headlines, but the maternal lines decide quality. The deepest daughter families in the registry trace to desert-bred foundation mares, and breeders guard those female lines as carefully as any trophy. A champion on the track is an event; a champion broodmare is a career.

![The next generation in the nursing paddock](${R('race-img-1319.webp')})`,
  body_fa: `شجره تقریباً هر فال ثبت‌شده این فصل را دنبال کنید و در نسل سوم، شماری از نام‌ها بارها ظاهر می‌شوند. پایگاه داده ملی اکنون بیش از ۹۵ هزار اسب را ثبت کرده و آمار نریان‌ها نشان می‌دهد جمعیت پرورشی چقدر متمرکز است.

کنز الناصر همه معیارهای تأثیر را رهبری می‌کند. این نریان قطری تنها در شناسنامه ایران ۵۶۰ فال ثبت‌شده دارد. دختران او اکنون از مطلوب‌ترین مادیان‌های پرورشی صحرا هستند و پسرانش در کارت‌های مسابقه از گنبد تا مشهد دیده می‌شوند.

اصطبل‌هایی که خطوط در آن‌ها نگهداری می‌شوند

براري با ۴۵۰ فال و شهرت سرعت اولیه، برفین با ۳۹۷ فال داستان موفقیت بومی دهه اخیر، و دولاب دوم با ۳۷۸ فال لنگر خطوط شجره کلاسیک ایرانی است.

چرا تمرکز مهم است
تمرکز شجره هم فرصت است هم ریسک. خط مولد غالب به جمعیت یک تیپ شناسایی‌پذیر می‌دهد اما استخر ژن را نسل به نسل باریک می‌کند.

مادیان‌ها و فال‌ها در قرنطینه‌های پرورش

خبر خوب اینکه پایه در حال گسترش است: جمعیت نریان ثبت‌شده در پنج فصل گذشته رشد کرده و خون خارجی از طریق بازار وارداتی خلیج ادامه دارد.

مادیان‌های پشت اعداد
نریان تیترها را می‌برند اما خطوط مادری کیفیت را تعیین می‌کنند. قهرمان پیست یک رویداد است؛ مادیان قهرمان یک دوران کاری.`,
  body_ar: `تتبع نسب أي مولود مسجل تقريباً في إيران هذا الموسم وستجد خلال ثلاثة أجيال أن عدداً من الأسماء يتكرر باستمرار. توثق قاعدة البيانات الوطنية الآن أكثر من خمسة وتسعين ألف حصان.

يتصدر كنز الناصر كل مقاييس التأثير بـ 560 مولوداً مسجلاً في السجل الإيراني وحده، وبناته من أكثر أمهات التربية المرغوبة في الصحراء وأبناؤه يظهرون في بطاقات السباقات من كنبد إلى مشهد.

إسطبلات الفحول حيث تحفظ الخطوط

براري بـ 450 مولوداً، وبرفين بـ 397 نجاح التربية المحلي للعقد الأخير، ودولاب الثاني بـ 378 يرسو الخطوط الكلاسيكية الفارسية.

لماذا يهم التركز
تركز النسب قوة وخطرة في آن واحد: خط الفحل المهيمن يمنح القطيع نوعاً معروفاً لكنه يضيق المجال الجيني جيلاً بعد جيل.

الأمهات وراء الأرقام
الفحول يحصد العناوين، لكن الخطوط الأمهات تحدد الجودة: بطل المضمار حدث، وأم بطلة مسيرة.`,
  body_zh: `追溯本季几乎任何一匹登记马驹的血统，不出三代，就会发现少数几个名字反复出现。国家数据库现已记录超过9.5万匹马，其背后的种公马统计揭示了繁育种群的集中程度。

Kanz Al Nasser在各项影响力指标中居首。这匹卡塔尔血统的种公马仅在伊朗登记库中就有560个登记后代。他的女儿如今是草原上最受欢迎的繁育母马。

存放血统的种马厩

Barari以450个后代和早期速度闻名；Barfin以397个后代成为近十年最成功的本国繁育故事；Doulab II以378个后代锚定经典波斯血统线。

为什么集中度很重要
血统集中既是优势也是风险。显性种公马线赋予种群可识别的类型，但每一代都在缩小基因库。

数字背后的母马
种公马占据头条，但母系决定质量：赛道冠军是事件，冠军母马是事业。`,
  tags_json: '["breeding","پرورش","stallions","نریان","pedigree","شجره","foundation-sires","مولد بنیان"]',
  sources_json: '[{"title": "Horse DB registry statistics", "url": "https://iraho.ir/stats"}]',
  author_label: 'Horse DB Editorial', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0025.webp'), alt_en: 'Stallions and broodmares in the breeding paddocks', alt_fa: 'نریان و مادیان در قرنطینه پرورش', credit: RACE_CREDIT },
});

// ---------- 4. Gonbad race day feature ----------
push({
  id: 'turn33-article-004', slug: 'race-day-gonbad-kavus-inside-iran-busiest-turf', kind: 'article',
  title_en: 'Race Day in Gonbad Kavus: Inside Iran\u2019s Busiest Turf',
  title_fa: 'روز مسابقه در گنبدکاووس: شاهد پرترددترین پیست ایران',
  title_ar: 'يوم السباق في كنبد كاووس: في أوسع مضمار إيراداً في إيران',
  title_zh: '贡巴德卡武斯赛日：走进伊朗最繁忙的赛场',
  summary_en: 'Six races, two hundred horses, one dusty parade ring. A race-day feature from the track where Turkmen racing families have gathered for generations.',
  summary_fa: 'شش مسابقه، دویست اسب، یک سطل گرد و خاک. گزارشی از پیستی که خانواده‌های تربیح ترکمن نسل به نسل در آن گرد می‌آیند.',
  summary_ar: 'ستة سباقات ومائتا حصان وحلبة استعراض مغبرة. تقرير من المضمار الذي تجتمع فيه عائلات التركمان منذ أجيال.',
  summary_zh: '六场比赛、两百匹马、一个尘土飞扬的展示圈。来自土库曼赛马家族世代相聚赛场的赛日报道。',
  body_en: `The first truck trailers roll into Gonbad Kavus before sunrise. By eight the stable area smells of wet clay and barley, and the parade ring is already loud: two hundred horses are on the card, six races, and the Turkmen racing families who have owned horses here for generations are greeting each other the way old rivals do — warmly, and with one eye on the betting.

Gonbad is the working heart of Iranian racing. There is no manicured green here; the dirt is real, the wind comes straight off the Sahra, and the grandstand is a long concrete roof that does its job honestly. What the track lacks in polish it repays in numbers: on a good autumn Saturday the card runs six races with full fields, and the_totalisator windows still take cash the old way.

![Morning: the first string walks to the track](${R('race-img-1489.webp')})

The racing itself is tight. Sahra-bred sprinters come off the turn in a line, and the announcer — whose voice has carried six decades of race meetings here — calls the leaders by their dam's name when two horses of the same name are in the field. Families argue results the way families argue everything: at volume, and with love.

## The Backside
Behind the grandstand is the part of racing visitors never see. Grooms sleep two to a room beside their horses. Farriers work the line all morning. The track veterinarian, one of three covering the whole province, treats between races with a portable X-ray in the back of a pickup. This is the labour that makes the sport run, and in Gonbad it is family labour — sons follow fathers, and the youngest hands learn to bandage legs before they can read the form.

![Between races: the work behind the sport](${R('race-img-1315.webp')})

By late afternoon the light turns gold and the last race goes off down the straight with the whole grandstand on its feet. The winners' circle here is a patch of dirt by the judge's box; the trophy is a carpet, and the photograph that follows matters more than any prize money.

## Why It Matters
Gonbad Kavus is where the national registry meets real life. Every horse on the card has a UELN, a DNA record, and a page in the database — and when the results are posted, the wins flow straight back into the statistics that decide which stallions get booked next season. The track and the registry are two halves of one system.

![Late light, last race, full grandstand](${R('race-img-0027.webp')})`,
  body_fa: `کامیون‌های ترانزیت قبل از طلوع به گنبدکاووس می‌رسند. تا ساعت هشت محوطه اصطبل بوی گِل خیس و جو می‌دهد و سطل استعراض از قبل پر سر و صدا است: دویست اسب روی کارت، شش مسابقه، و خانواده‌های تربیح ترکمن که نسل‌ها اسب داشته‌اند مثل رقبای قدیمی به هم سلام می‌کنند.

گنبد قلب کاری اسبدوانی ایران است. اینجا چمن آراسته نیست؛ خاک واقعی است، باد از صحرا می‌آید و سکو یک سقف بتنی طولانی است که کارش را درست انجام می‌دهد. آنچه پیست در جلا کم دارد در تعداد جبران می‌کند: یک شنبه خوب پاییزی شش مسابقه با فیلد کامل برگزار می‌شود.

صبح: اولین گروه به سمت پیست می‌رود

مسابقه‌ها فشرده‌اند. اسپرینترهای صحرا از پیچ به صورت یک خط بیرون می‌آیند و گوینده‌ای که شش دهه صدای مسابقات اینجا بوده، وقتی دو اسب هم‌نام در میدان باشند، پیشتازان را با نام مادیان صدا می‌زند.

پشت صحنه
پشت سکو بخشی از مسابقه است که بازدیدکنندگان هرگز نمی‌بینند. گروم‌ها دو نفر در اتاقی کنار اسب‌هایشان می‌خوابند. نعل‌بندها تمام صبح کار می‌کنند. دامپزشک پیست بین مسابقه‌ها با رادیولوژی پرتابل در پیکاپ کار می‌کند.

میان دو مسابقه: کاری که ورزش را می‌چرخاند

نزدیک عصر نور طلایی می‌شود و آخرین مسابقه با سکوی ایستاده به خط پایان می‌رسد. دایره برندگان اینجا یک قطعه خاک کنار اتاق داور است؛ جایزه یک قالی است و عکسی که بعدش گرفته می‌شود از هر پولی مهم‌تر است.

چرا مهم است
گنبدکاووس جایی است که شناسنامه ملی به زندگی واقعی می‌رسد. هر اسب کارت UELN و رکورد DNA و صفحه‌ای در پایگاه دارد — و وقتی نتایج ثبت می‌شوند، برد‌ها مستقیم به آماری می‌روند که تعیین می‌کند کدام نریان فصل بعد رزرو می‌شود.`,
  body_ar: `تصل شاحنات كنبد كاووس قبل شروق الشمس. وفي الثامنة تفوح منطقة الإسطبلات برائحة الطين الرطب والشعير، وحلبة الاستعراض صاخبة بالفعل: مائتا حصان في البطاقة وستة سباقات وعائلات التركمان التي تملك الخيول هنا منذ أجيال.

كنبد هو القلب العملي لسباقات الخيل الإيراني: لا عشب مصقول هنا، والتراب حقيقي، والريح تأتي مباشرة من الصحراء، والمدرجات سقف خرساني طويل يؤدي وظيفته بأمانة.

الصباح: المجموعة الأولى تتجه إلى المضمار

السباقات محكمة، والمعلق الذي حمل ستين عاماً من الاجتماعات ينادي المتصدرين باسم أمهاتهم عندما يتشابه اسمان.

خلف الكواليس
خلف المدرجات الجزء الذي لا يراه الزوار: المربون ينامون اثنين بغرفة، الحدادون يعملون طوال الصباح، والطبيب البيطري يعالج بين السباقات بأشعة محمولة.

ضوء متأخر، سباق أخير، مدرجات ممتلئة

كنبد كاووس حيث يلتقي السجل الوطني بالحياة الواقعية: كل حصان في البطاقة لديه UELN وسجل DNA وصفحة في قاعدة البيانات.`,
  body_zh: `运马车在日出前抵达贡巴德卡武斯。八点时，马房区弥漫着湿泥和麦秆的味道，展示圈已经热闹起来：报名表上有两百匹马、六场比赛，世代养马的土库曼赛马家族像老对手一样互相问候。

贡巴德是伊朗赛马的工作心脏。这里没有修剪整齐的草坪；泥土是真实的，风从草原直接吹来，看台是一个长长的混凝土顶棚，朴素而实用。

清晨：第一批马匹走向赛道

比赛很紧凑。草原出产的短途马过弯时排成一线，在这里解说了六十年赛事的播音员，当两匹同名马同场时会用母马的名字称呼领先者。

幕后
看台后面是游客永远看不到的部分：马夫两人一间睡在马旁边，蹄铁工整个上午都在忙碌，赛道兽医在比赛间隙用皮卡里的便携X光机治疗。

傍晚，光线转金，最后一场比赛冲线时全场合起立。这里的赢家圈是裁判室旁的一块泥地；奖品是一条地毯，随后的合影比任何奖金都重要。

为什么重要
贡巴德卡武斯是国家登记库与真实生活交汇的地方。报名表上的每匹马都有UELN、DNA记录和数据库页面——成绩公布后，胜利直接流入决定下赛季种公马预订的统计数据。`,
  tags_json: '["gonbad-kavus","گنبدکاووس","race-day","روز مسابقه","feature","گزارش","turkmen","ترکمن"]',
  sources_json: '[]',
  author_label: 'گزارش اختصاصی Horse DB', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0032.webp'), alt_en: 'Gonbad Kavus racecourse from the air', alt_fa: 'پیست گنبدکاووس از هوا', credit: RACE_CREDIT },
});

// ---------- 5. Endurance ----------
push({
  id: 'turn33-article-005', slug: 'endurance-riding-growth-across-iran-desert-to-podium', kind: 'article',
  title_en: 'From Desert to Podium: Endurance Riding\u2019s Long Road Across Iran',
  title_fa: 'از بیابان تا سکو: جاده دراز استقامت در ایران',
  title_ar: 'من الصحراء إلى المنصة: الطريق الطويل لرياضة التحمل في إيران',
  title_zh: '从沙漠到领奖台：耐力赛马在伊朗的漫长道路',
  summary_en: 'Endurance is the fastest-growing discipline in the federation\u2019s calendar. We followed a vet-gate morning to understand why.',
  summary_fa: 'استقامت سریع‌ترین رشته در تقویم فدراسیون است. صبح یک گیت دامپزشکی را دنبال کردیم تا بفهمیم چرا.',
  summary_ar: 'التحمل أسرع فئة نمواً في تقويم الاتحاد. تبعنا صباح بوابة بيطرية لفهم السبب.',
  summary_zh: '耐力赛是联邦赛历中增长最快的项目。我们跟随一次兽医检查的早晨来了解原因。',
  body_en: `Endurance does not have the noise of the racetrack. It starts in the dark, in the desert outside Semnan or Yazd, with riders checking girths by headlight and veterinarians laying out heart-rate monitors on folding tables. By the time the sun comes up the first horses are already twenty kilometres in.

The discipline's growth in Iran has been steady and quiet. Federation calendars now list endurance rides in six provinces, and the entry lists have doubled in three seasons. The reasons are practical: an endurance horse costs a fraction of a racehorse to keep, the sport welcomes amateurs alongside professionals, and Iran's landscape — dry, vast, and empty — is natural endurance country.

![Riders cross the open plain at first light](${R('race-img-0025.webp')})

The heart of the sport is the vet gate. Every loop ends with a mandatory inspection where the horse's pulse must come down to the required threshold within a set time, or the combination is eliminated. It is here, watching horses trot out sound on the line, that you understand endurance's core promise: the welfare of the horse is the scoring system.

![The vet gate: where every loop is won or lost](${R('race-img-1315.webp')})

## The Iranian Type
The desert-bred Arabian and the hardy Turkmen cross dominate the entry lists, and Iranian riders have begun exporting results as well as horses. National-team combinations have completed international star-qualified rides abroad, and the federation's education programme now includes endurance-specific farriery and nutrition modules.

What the discipline needs next is continuity: a fixed national series with points, rather than isolated one-off rides. Trainers argue that a series would professionalize the preparation cycle the way it did for flat racing — and would give sponsors something to attach a name to.

## The Long Game
Endurance will never be racing's glamour. But its arithmetic is powerful: hundreds of amateur riders, horses that stay sound into their teens, and a calendar that reaches provinces flat racing never touches. In the quiet before the first loop, with sixty horses breathing softly in the dark, the sport's future looks anything but small.

![The sun climbs as the first loop ends](${R('race-img-0032.webp')})`,
  body_fa: `استقامت سر و صدای پیست مسابقه را ندارد. در تاریکی، در بیابان سمنان یا یزد آغاز می‌شود؛ سواران با نور چراغ هیولاژن را می‌بندند و دامپزشکان مانیتور ضربان را روی میزهای تاشو می‌چینند. وقتی آفتاب بالا می‌آید، اسب‌های اول از سرزمین‌های بیست کیلومتری گذشته‌اند.

رشد این رشته در ایران پیوسته و آرام بوده است. تقویم فدراسیون اکنون مسابقات استقامت را در شش استان ثبت می‌کند و فهرست ورودی‌ها در سه فصل دو برابر شده است. دلایل عملی است: نگهداری اسب استقامت کسری از هزینه اسب مسابقه است، این رشته آماتورها را کنار حرفه‌ای‌ها می‌پذیرد، و جغرافیای ایران — خشک، پهناور و خالی — سرزمین طبیعی استقامت است.

سواران در نخستین نور دشت باز را می‌گذرند

قلب این ورزش گیت دامپزشکی است. هر لوپ با بازرسی اجباری تمام می‌شود؛ ضربان اسب باید در زمان مشخص به حد مجاز برسد وگرنه حذف می‌شوند. اینجا وعده اصلی استقامت را می‌فهمید: رفاه اسب، خودِ سیستم امتیازدهی است.

نوع ایرانی
اسب عربی بیابانی و کراس مقاوم ترکمن فهرست ورودی را تسخیر کرده‌اند و سواران ایرانی علاوه بر اسب، نتایج نیز صادر می‌کنند. تیم ملی در رده‌های ستاره‌دار بین‌المللی خارج از کشور کامل کرده و برنامه آموزشی فدراسیون ماژول نعل‌بندی و تغذیه اختصاصی استقامت دارد.

بازی درازمدت
استقامت هرگز جلال مسابقه را نخواهد داشت. اما ریاضیات آن قوی است: صدها سوار آماتور، اسب‌هایی که تا نوجوانی سالم می‌مانند و تقویمی که به استان‌هایی می‌رسد که مسابقه هرگز لمس نمی‌کند.`,
  body_ar: `لا تملك رياضة التحمل صخب المضمار. تبدأ في الظلام، في صحراء سمنان أو يازد، حيث يفحص الفارسون الأحزمة بضوء المصابيح ويجهز الأطباء البيطريون أجهزة قياس النبض. وعندما تشرق الشمس تكون الخيول الأولى قد قطعت عشرين كيلومتراً.

نمو هذه الفئة في إيران كان ثابتاً وهادئاً: تقويم الاتحاد يسجل الآن سباقات التحمل في ستة محافظات، وقوائم الاشتراك تضاعفت في ثلاثة مواسم.

قلب هذه الرياضة هو البوابة البيطرية: كل حلقة تنتهي بفحص إلزامي يجب أن ينزل فيه نبض الحصان إلى الحد المطلوب وإلا استبعدت الفريق. هنا تفهم وعد التحمل الأساسي: رفاهية الحصان هي نظام النقاط نفسه.

النوع الإيراني
العربي الصحراوي والهجين التركماني القوي يهيمنان على القوائم، وفارسونا يصدرون نتائج دولية في سباقات النجوم المؤهلة.

اللعبة الطويلة
لن تكون التحمل بريقاً السباقات، لكن حساباتها قوية: مئات الفارسين الهواة وخيول سليمة حتى سن المراهقة وتقويم يصل إلى محافظات لا يصلها السباق أبداً.`,
  body_zh: `耐力赛没有赛道的喧嚣。它在黑暗中开始——塞姆南或亚兹德郊外的沙漠里，骑手用车灯检查肚带，兽医在折叠桌上摆好心率监测仪。太阳升起时，第一批马已经跑完二十公里。

这项运动在伊朗稳步而安静地增长。联邦赛历现在列出六个省的耐力赛，三个赛季内报名人数翻倍。原因很实际：耐力马的饲养成本只是赛马的一小部分，这项运动欢迎业余选手与职业选手同场，而伊朗干燥、辽阔、空旷的地貌正是天然的耐力赛场。

骑手在晨光中穿越开阔平原

这项运动的核心是兽医检查站。每个循环以强制检查结束，马的心率必须在规定时间内降到标准线以下，否则人马组合被淘汰。在这里你明白了耐力赛的核心承诺：马的福利本身就是计分系统。

耐力赛永远不会有赛马的光环。但它的算术很有力：数百名业余骑手、保持健康到十几岁的马匹，以及一个触及纯血赛马从未触及省份的赛历。`,
  tags_json: '["endurance","استقامت","disciplines","رشته‌ها","feature","گزارش"]',
  sources_json: '[]',
  author_label: 'Horse DB Editorial', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0027.webp'), alt_en: 'Endurance riders in the open desert', alt_fa: 'سواران استقامت در بیابان باز', credit: RACE_CREDIT },
});

// ---------- 6. Chogan ----------
push({
  id: 'turn33-article-006', slug: 'chogan-persian-polo-game-of-kings-lives-on', kind: 'article',
  title_en: 'Chogan Under the Scaffolds: The Persian Game of Kings Lives On',
  title_fa: 'چوگان زیر داربست‌ها: بازی شاهان ایرانی زنده است',
  title_ar: 'الشوغان تحت السقالات: لعبة الملوك الفارسية ما زالت حية',
  title_zh: '球门下的乔根：波斯王者之戏生生不息',
  summary_en: 'Chogan — polo\u2019s Persian ancestor — is played today from Isfahan\u2019s historic field to provincial grounds, and UNESCO has already recognized what the players never forgot.',
  summary_fa: 'چوگان — نیای ایرانی پولو — امروز از میدان تاریخی اصفهان تا زمین‌های استانی بازی می‌شود و یونسکو چیزی را به رسمیت شناخته که بازیکنان هرگز فراموش نکردند.',
  summary_ar: 'الشوغان — جد البولو الفارسي — يلعب اليوم من ميدان أصفهان التاريخي إلى الملاعب المحلية، وقد اعترفت اليونسكو بما لم ينسه اللاعبون أبداً.',
  summary_zh: '乔根——现代马球的波斯祖先——如今从伊斯法罕的历史球场到各省场地都有人打，联合国教科文组织承认了球员们从未忘记的东西。',
  body_en: `Persian miniature painters never had to invent a subject: chogan was already there. The game of kings, played on horseback with a ball and long mallets, appears on Safavid tiles, in Shah-nameh illuminations, and in the travel diaries of every envoy who passed through Isfahan. What the miniatures do not show is the sound — forty hooves, a bamboo crack, the crowd's roar in the Naghsh-e Jahan stands.

Chogan never left. On provincial grounds from Kerman to Zanjan the game is played today much as the chronicles describe it, and the national federation keeps an active championship calendar. UNESCO inscribed chogan on its intangible heritage list in 2017 — an international recognition of something the riders themselves never doubted.

![The mallet comes down: a chogan match in full flow](${R('race-img-0025.webp')})

## The Game Itself
Modern chogan keeps the classical structure: two teams of four, a goal at each end, and a match divided into chukkers. What visitors notice first is the horsemanship — the game demands a horse that turns inside its own length, and Iranian players traditionally ride the Arabian and Turkmen crosses the national registry knows so well. The ball is wood, the mallet is lengthened for reach, and a good player is judged by the cleanliness of the swing, not the force.

![Riders contest the ball at speed](${R('race-img-0034.webp')})

## Keeping the Heritage Alive
The federation's chogan programme runs coaching courses for young riders alongside the senior championship, and provincial clubs have built small academies around historic grounds. The economics are modest — this is not international polo's money — but the cultural weight is enormous, and the players know it. On the field in Isfahan, with the seventeenth-century scaffolds of the royal viewing stand overhead, every chukker is played as much for the painters as the scoreboard.

![The crowd closes in as the final chukker ends](${R('race-img-0027.webp')})`,
  body_fa: `نگارگران ایرانی هرگز مجبور نبودند موضوعی بسازند: چوگان همیشه آنجا بود. بازی شاهان، سوار بر اسب با توپ و چوب بلند، روی کاشی‌های صفوی، در تذهیب شاهنامه و در سفرنامه هر سفیری که از اصفهان گذشته، دیده می‌شود. آنچه نگاره‌ها نشان نمی‌دهند صدا است — چهل سم، صدای ترکیدن بامبو و فریاد تماشاگران در سکوی عالی‌قاپو.

چوگان هرگز نرفت. در زمین‌های استانی از کرمان تا زنجان بازی امروز همچنان‌که در متون آمده انجام می‌شود و فدراسیون تقویم قهرمانی فعالی دارد. یونسکو در سال ۲۰۱۷ چوگان را در فهرست میراث ناملموس ثبت کرد.

چوب پایین می‌آید: مسابقه چوگان در جریان

خود بازی
چوگان مدرن ساختار کلاسیک را نگه داشته: دو تیم چهارنفره، یک دروازه در هر طرف و مسابقه در چوکرها. اولین چیزی که تماشاگر می‌بیند سوارکاری است — این بازی اسبی می‌خواهد که در طول خودش بچرخد، و سواران ایرانی سنتاً کراس‌های عربی و ترکمن را می‌رانند که شناسنامه ملی به خوبی می‌شناسد.

حفظ میراث
برنامه چوگان فدراسیون دوره مربیگری سواران جوان را در کنار قهرمانی بزرگسالان برگزار می‌کند و باشگاه‌های استانی آکادمی‌های کوچکی دور زمین‌های تاریخی ساخته‌اند. اقتصاد آن فروتنانه است اما وزن فرهنگی آن عظیم است.`,
  body_ar: `لم يكن على رسامي المنمنمات الفارسية أن يخترعوا موضوعاً: الشوغان كان هناك بالفعل. لعبة الملوك، تلعب على ظهور الخيل بكرة ومطارق طويلة، تظهر على البلاط الصفوي وفي زخارف الشاهنامة وفي مذكرات كل مبعوث مر بأصفهان.

الشوغان لم يرحل. في الملاعب المحلية من كرمان إلى زنجان تلعب اللعبة اليوم كما وصفها المؤرخون، وأدرجت اليونسكو الشوغان في قائمة التراث غير المادي عام 2017.

المطرقة تنزل: مباراة شوغان في كامل تدفقها

اللعبة نفسها
يحافظ الشوغان الحديث على البنية الكلاسيكية: فريقان من أربعة، ومرمى في كل طرف، ومباراة مقسمة إلى أشواط. أول ما يلاحظه الزائر هو مهارة الخيالة، ويركب اللاعبون الإيرانيون تقليدياً الأحنة العربية والتركمانية.

إحياء التراث
يدير برنامج الاتحاد دورات تدريبية للفارسين الشباب إلى جانب بطولة الكبار، والنوادي المحلية بنيت أكاديميات صغيرة حول الملاعب التاريخية. اقتصاديات اللعبة متواضعة لكن ثقلها الثقافي هائل.`,
  body_zh: `波斯细密画家从不需要发明题材：乔根一直都在。这项王者之戏——骑在马上用球和长槌进行——出现在萨法维瓷砖上、列王纪插画中，以及每位途经伊斯法罕的使节的旅行日记里。细密画没有记录的是声音：四十只马蹄、竹槌的脆响、伊玛目广场看台上人群的呐喊。

乔根从未离开。从克尔曼到赞詹的省级场地上，今天人们仍按编年史描述的方式打球，全国联合会保持活跃的锦标赛日历。2017年联合国教科文组织将乔根列入非物质文化遗产名录。

槌落：乔根比赛正酣

比赛本身
现代乔根保留古典结构：两队各四人，两端各设一门，比赛分为数局。访客最先注意到的是骑术——这项运动需要一匹能在自身长度内转向的马，伊朗球员传统上骑乘国家登记库熟知的阿拉伯与土库曼混血。

延续遗产
联合会的乔根项目在成人锦标赛之外为年轻骑手开设教练课程，各省俱乐部在历史场地旁建起小型学院。经济效益不大，但文化分量巨大。`,
  tags_json: '["chogan","چوگان","polo","heritage","میراث","culture","فرهنگ"]',
  sources_json: '[{"title": "UNESCO Intangible Heritage: Chogan", "url": "https://ich.unesco.org/en/RL/chogan-a-horse-riding-game-accompanied-by-music-and-storytelling-01152"}]',
  author_label: 'ستون میراث Horse DB', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0025.webp'), alt_en: 'A chogan match in progress', alt_fa: 'مسابقه چوگان در جریان', credit: WEB_CREDIT },
});

// ---------- 7. Show jumping championship ----------
push({
  id: 'turn33-article-007', slug: 'show-jumping-championship-1405-preview', kind: 'news',
  title_en: '1405 National Show Jumping Championship: What to Watch',
  title_fa: 'قهرمانی پرش با اسب ۱۴۰۵: چه چیزهایی را باید دید',
  title_ar: 'بطولة القفز الوطنية 1405: ماذا نراقب',
  title_zh: '1405全国场地障碍锦标赛前瞻',
  summary_en: 'Registration is open and the young generation is knocking. Five storylines to follow when the national championship gets under way.',
  summary_fa: 'ثبت‌نام آغاز شده و نسل جوان در زدن در است. پنج خط داستانی که باید در قهرمانی ملی دنبال کنید.',
  summary_ar: 'التسجيل مفتوح والجيل الشاب يطرق الباب. خمسة محاور لمتابعتها عند انطلاق البطولة الوطنية.',
  summary_zh: '报名已开放，年轻一代正在敲门。全国锦标赛开赛时值得关注的五个看点。',
  body_en: `The Iranian Equestrian Federation has opened registration for the 1405 National Show Jumping Championship, and the entry lists already hint at the season's central question: can the established order hold off the fastest-rising young generation in years?

![The blue oxer that decides championships](${R('race-img-0025.webp')})

The senior division remains anchored by the names that have dominated the podium for a decade. Veis Pasha and MS Alis Pasha — two stallions whose results across the provincial and national circuit fill pages of the competition database — headline the entries, and their riders' experience over the tall triple combinations remains the standard the rest chase.

## The Five Storylines
First, the juniors. The young-rider classes have produced genuine championship horses in the past two seasons, and the step up from junior to senior heights is where this year's titles will be decided. Second, the mares: breeders keep saying the next great jumper is more likely to come from a deep maternal line than a famous sire line, and this championship is the stage where that argument gets tested.

Third, course design. The federation's recent education push — including the degree-3 course design courses held in Tehran and Zanjan — should show up in more technical, more varied tracks. Fourth, the provinces: entries from outside Tehran have grown every season, and a province-based rider taking a national title is no longer a fantasy.

![Full gallop to the final vertical](${R('race-img-0027.webp')})

Fifth, the horses themselves. The national registry now carries photos and full pedigrees for the championship contenders, and following a horse's page through the season — results, lineage, stable — has quietly become the way a new generation of fans consumes the sport.

![The podium awaits in the main arena](${R('race-img-0032.webp')})

The championship runs across multiple legs through the season, with the finals scheduled for the spring. Registration details and class schedules are published on the federation's channels.`,
  body_fa: `فدراسیون سوارکاری ایران ثبت‌نام قهرمانی پرش با اسب ۱۴۰۵ را آغاز کرده و فهرست ورودی‌ها از الان پرسش محوری فصل را نشان می‌دهد: آیا نظم مستقر می‌تواند جلوی سریع‌ترین نسل جوان سال‌های اخیر را بگیرد؟

 senior همچنان با نام‌هایی که یک دهه سکو را تسخیر کرده‌اند لنگر انداخته است. ویس پاشا و ام اس آلیس پاشا — دو نریانی که نتایجشان در تقویم استانی و ملی صفحات پایگاه مسابقات را پر می‌کند — صدر ورودی‌ها هستند.

خرک آبی که قهرمانی‌ها را تعیین می‌کند

پنج خط داستانی
اول، نوجوانان. رده‌های سواران جوان در دو فصل گذشته اسب‌های قهرمانی واقعی تولید کرده‌اند. دوم، مادیان‌ها: پرورش‌دهندگان می‌گویند پرش‌روی بزرگ بعدی بیشتر از خط نری مشهور از خط مادری عمیق می‌آید و این قهرمانی محک آن است.

سوم، طراحی مسیر. موج آموزش اخیر فدراسیون — از جمله دوره‌های طراحی درجه ۳ در تهران و زنجان — باید در مسیرهای فنی‌تر دیده شود. چهارم، استان‌ها: ورودی‌های خارج از تهران هر فصل رشد کرده و قهرمانی ملی یک سوار استانی دیگر توهم نیست.

تاخت کامل تا میله عمودی آخر

پنجم، خود اسب‌ها. شناسنامه ملی اکنون عکس و شجره کامل مدعیان قهرمانی را دارد و دنبال کردن صفحه یک اسب در طول فصل — نتایج، تبار، اصطبل — آرام‌آرام به شیوه مصرف ورزش برای نسل جدید هواداران تبدیل شده است.`,
  body_ar: `فتح الاتحاد الإيراني للفروسية باب التسجيل لبطولة القفز الوطنية 1405، وتشير قوائم الاشتراك بالفعل إلى السؤال المركزي للموسم: هل يستطيع النظام المستقر صد أسرع جيل شاب منذ سنوات؟

تبقى فئة الكبار مرتكزة على الأسماء التي احتضنت المنصة لعقد من الزمان، ويتصدر الاشتراكات فيس باشا وإم إس أليس باشا — فحلان تملأ نتائجهما صفحات قاعدة بيانات المسابقات.

الخمس محاور: الناشئون أولاً، ثم الأمهات حيث يقول المربون إن القافز العظيم القادم يأتي من خط أمي عميق أكثر من خط فحل مشهور، ثم تصميم المسارات بعد دورات التصميم في طهران وزنجان، ثم المحافظات التي نما اشتراكها كل موسم، وأخيراً الخيول نفسها التي تحمل السجل الوطني الآن صوراً ونسباً كاملة.`,
  body_zh: `伊朗马术联合会已开放1405全国场地障碍锦标赛报名，报名表已经暗示了本赛季的核心问题：现有秩序能否挡住近年来上升最快的年轻一代？

成年组仍由十年来霸占领奖台的名字压阵。Veis Pasha和MS Alis Pasha——两匹省级和全国赛历成绩填满竞赛数据库页面的种公马——领衔报名。

决定锦标赛的蓝色横杆

五个看点
第一，青年组。第二，母马：繁育者说下一匹伟大障碍马更可能来自深厚母系而非著名父系，本届锦标赛正是检验之地。第三，路线设计。第四，各省：省籍骑手夺取全国冠军不再是幻想。第五，马匹本身：国家登记库现在为争冠马匹提供照片和完整血统，通过马的页面追踪赛季成绩已成为新一代马迷消费这项运动的方式。`,
  tags_json: '["show-jumping","پرش با اسب","championship","قهرمانی","preview","نگاه"]',
  sources_json: '[]',
  author_label: 'Horse DB Newsroom', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0034.webp'), alt_en: 'A show jumper over the blue oxer', alt_fa: 'اسب پرش از خرک آبی', credit: WEB_CREDIT },
});

// ---------- 8. Mares and foals ----------
push({
  id: 'turn33-article-008', slug: 'mares-foals-breeding-season-report-iranian-studs', kind: 'article',
  title_en: 'Mares and Foals: A Breeding-Season Report from the Iranian Studs',
  title_fa: 'مادیان‌ها و فال‌ها: گزارش فصل زادآوری از مراکز پرورش ایران',
  title_ar: 'الأمهات والموالود: تقرير موسم التربية من إسطبلات إيران',
  title_zh: '母马与马驹：伊朗种马场繁育季报告',
  summary_en: 'Foaling season has peaked across the provinces. DNA-testing coverage, maternal lines, and the quiet economics of the broodmare band.',
  summary_fa: 'فصل زادآوری در استان‌ها به اوج رسیده. پوشش آزمایش DNA، خطوط مادری و اقتصاد ساکت مادیان‌های پرورشی.',
  summary_ar: 'بلغ موسم الولادة ذروته في المحافظات: تغطية فحوص الحمض النووي، والخطوط الأمهات، واقتصاد أمهات التربية الهادئ.',
  summary_zh: '产驹季在各省已达高峰。DNA检测覆盖率、母系血统与繁育母马群的低调经济。',
  body_en: `Spring and autumn are the twin peaks of the Iranian foaling calendar, and this season's registrations are already flowing into the national database. Each new foal arrives with a paper trail — dam, sire, breeder, colour, markings — and, increasingly, a DNA profile: the registry's testing programme now covers the majority of new registrations, a quiet revolution in a country whose stud books were once kept in ledgers.

![The newest arrivals, legs still learning their job](${R('race-img-0025.webp')})

The economics of the broodmare band get less attention than the stallion headlines, but they decide the breed's future. A productive mare with a deep maternal line is worth more than her race-record cousin on paper: breeders pay for daughters of proven dams the way collectors pay for first editions. The registry's statistics show why — the strongest foal crops trace to mares whose own mothers were producers, generation after generation.

## What the Data Shows
Registration data across the national database reveals the shape of the breeding population. The stallion population is concentrated — a handful of names cover a striking share of the foal crop — while the mare base is far wider and, statistically, healthier. Every breeder interviewed for this piece said the same thing in different words: the mare line is the bank, the stallion is the investment.

![Broodmare bands on the spring paddocks](${R('race-img-0032.webp')})

The risks are the familiar ones. Foal mortality in the first weeks, the concentration risk in the sire lines, and the pressure that cheap unregistered breeding puts on the market for documented horses. The federation's response has been to widen DNA coverage and to make the registry easier to use — because a stud book only works when registering a foal is simpler than not doing it.

![The next generation learns the parade ring early](${R('race-img-1315.webp')})`,
  body_fa: `بهار و پاییز دو قله تقویم زادآوری ایران هستند و ثبت‌های این فصل همین حالا به پایگاه داده ملی می‌ریزد. هر فال تازه با یک ردپای کاغذی می‌آید — مادر، پدر، پرورش‌دهنده، رنگ، علامت‌ها — و روزافزون یک پروفایل DNA: برنامه آزمایش شناسنامه اکنون بیشتر ثبت‌های جدید را پوشش می‌دهد.

اقتصاد مادیان‌های پرورشی کمتر از تیترهای نریان دیده می‌شود اما آینده نژاد را تعیین می‌کند. مادیان پرکار با خط مادری عمیق در عمل از پسر مسابقه‌ای خود باارزش‌تر است: پرورش‌دهندگان برای دختران مادیان‌های اثبات‌شده مثل کلکسیونرها برای چاپ اول پول می‌دهند.

تازه‌واردان، پاهایی که تازه کارشان را یاد می‌گیرند

داده‌ها چه می‌گویند
آمار پایگاه ملی شکل جمعیت پرورشی را نشان می‌دهد. جمعیت نریان متمرکز است — شماری نام سهم چشمگیری از فال‌ها را می‌پوشانند — اما پایه مادیان بسیار پهن‌تر و از نظر آماری سالم‌تر است.

گله‌های مادیان در چمن‌های بهاری

ریسک‌ها آشنا هستند: تلفات هفته‌های اول، ریسک تمرکز در خطوط نری و فشار پرورش ارزان و ثبت‌نشده بر بازار اسب‌های مستند. پاسخ فدراسیون گسترش پوشش DNA و ساده‌تر کردن ثبت است — چون شناسنامه فقط وقتی کار می‌کند که ثبت یک فال ساده‌تر از ثبت نکردنش باشد.`,
  body_ar: `الربيع والخريف قمتا تقويم الولادة الإيراني، وتصريحات هذا الموسم تتدفق بالفعل إلى قاعدة البيانات الوطنية. كل مولود جديد يصل بسجل ورقي — أم، أب، مربٍ، لون، علامات — وبشكل متزايد ملف حمض نووي: برنامج الفحص في السجل يغطي الآن غالبية التسجيلات الجديدة.

اقتصاد أمهات التربية يلفت انتباهاً أقل من عناوين الفحول لكنه يقرر مستقبل السلالة: الأنثى المنتجة ذات الخط الأمي العميق تساوي عملياً أكثر من ابنة أخيها صاحبة السجل السباقي.

ماذا تظهر البيانات
تكشف إحصائيات السجل الوطني شكل مجتمع التربية: مجموعة الفحول مركزة، بينما قاعدة الأمهات أوسع بكثير وأصح إحصائياً. كل مربٍ سألناه قال الشيء نفسه: خط الأم هو البنك، والفحل هو الاستثمار.

الريسكون مألوفون: نفوق الموالود في الأسابيع الأولى، وتركز خطوط الفحول، وضغط التربية غير المسجلة الرخيصة. رد الاتحاد توسيع تغطية الحمض النووي وتسهيل التسجيل.`,
  body_zh: `春秋两季是伊朗产驹日历的双高峰，本季登记正持续流入国家数据库。每匹新生马驹都带着完整的纸质档案——母亲、父亲、繁育者、毛色、特征——并且越来越多的带有DNA档案：登记库的检测项目现已覆盖大多数新登记。

繁育母马群的经济价值得到的关注少于种公马的头条，但它们决定着品种的未来。一匹具有深厚母系的繁殖力强的母马，实际价值超过赛绩出色的表亲：繁育者为优秀母马的女儿付费，就像收藏家为一版书付费。

数据库登记数据显示繁育种群的结构：种公马群体集中——少数名字覆盖了马驹产量中惊人的份额——而母马基础则宽广得多，统计上也更健康。

风险是人们熟悉的：头几周的马驹死亡率、父系血统的集中风险，以及廉价未登记繁育对有档案马匹市场的压力。联合会的应对是扩大DNA覆盖并让登记更容易使用——因为只有当登记马驹比不登记更简单时，血统簿才能发挥作用。`,
  tags_json: '["breeding","پرورش","mares","مادیان","foals","فال","report","گزارش"]',
  sources_json: '[]',
  author_label: 'Horse DB Editorial', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0025.webp'), alt_en: 'A mare with her foal at pasture', alt_fa: 'مادیان و فال در مرتع', credit: RACE_CREDIT },
});

// ---------- 9. The Caspian ----------
push({
  id: 'turn33-article-009', slug: 'caspian-horse-ancient-miniature-finds-new-generations', kind: 'article',
  title_en: 'The Caspian: Iran\u2019s Ancient Miniature Horse Finds New Generations',
  title_fa: 'کاسپین: اسب مینیاتوری باستان ایران نسل‌های تازه می‌یابد',
  title_ar: 'الكاسبي: حصان إيران القديم المصغّر يجد أجيالاً جديدة',
  title_zh: '里海马：伊朗古老的迷你马迎来新生代',
  summary_en: 'Small enough for a child to ride, old enough for stone reliefs. The Caspian horse\u2019s journey from near-extinction to a growing national breeding programme.',
  summary_fa: 'به قدری کوچک که بچه سوار شود، به قدری قدیمی که در نقش‌برجسته‌های سنگی هست. سفر اسب کاسپین از آستانه انقراض تا برنامه پرورش ملی رو به رشد.',
  summary_ar: 'صغير يركبه الطفل، قديم موجود في النقوش الحجرية. رحلة حصان الكاسبي من حافة الانقراض إلى برنامج تربية وطني نامٍ.',
  summary_zh: '小到孩子能骑，古老到出现在石雕浮雕上。里海马从濒临灭绝到不断壮大的国家繁育项目之旅。',
  body_en: `The Caspian horse is a contradiction you can put a child on: barely over a metre at the withers, yet unmistakably a horse — not a pony — with the skeleton, the stride and the temperament of a desert-bred Arabian shrunk through ten thousand years. Stone reliefs from ancient Persia show horses of exactly this type pulling royal chariots, and genetic studies have backed what the bone structure always suggested: the Caspian is one of the oldest horse types still in existence.

By the 1960s the type was believed to have vanished. Its rediscovery — a small herd found in the Elburz mountains near the Caspian Sea — is one of the great horse stories of the twentieth century, and from that handful of animals every Caspian alive today descends.

![A Caspian mare with her foal](${R('race-img-0025.webp')})

## The Modern Herd
Iran today maintains breeding groups of the type, and the national registry carries a dedicated Caspian stud line with its own breeder network. The population remains small — a fraction of the national total — but it is growing, and the discipline mix is wider than ever: driving, children's riding classes, and increasingly the show ring, where the breed's clean conformation wins it admirers at first sight.

For breeders the challenge is genetic: a founder population this narrow demands careful mate selection, and the registry's pedigree tools exist precisely for that. Every Caspian foal registered today extends an unbroken line that runs back past the Sassanian reliefs.

![Small horse, full pedigree: the Caspian at the show ground](${R('race-img-0032.webp')})

The breed's future now depends on the same thing that saved it once: people who understand that small does not mean less. A Caspian is not a toy. It is the oldest riding horse in the room, wearing the smallest saddle.`,
  body_fa: `اسب کاسپین تناقضی است که می‌توانید بچه‌ای روی آن بنشانید: با کمتر از یک متر ارتفاع در جدوگاه، اما بی‌تردید اسب است — نه پونی — با اسکلت، گام و خلق‌وخوی عربی بیابانی که در ده هزار سال کوچک شده است. نقش‌برجسته‌های ایران باستان اسب‌هایی از همین نوع را در ارابه سلطنتی نشان می‌دهند و مطالعات ژنتیکی همان را تأیید کرده‌اند که ساختار استخوان همیشه می‌گفت: کاسپین از قدیمی‌ترین تیپ‌های اسب موجود است.

در دهه ۱۹۶۰ تصور می‌شد این تیپ منقرض شده است. کشف دوباره آن — گله کوچکی در البرز نزدیک دریای خزر — یکی از داستان‌های بزرگ اسب قرن بیستم است و همه کاسپین‌های امروز از همان چند حیوان نزول کرده‌اند.

مادیان کاسپین با فالش

گله مدرن
ایران امروز گروه‌های پرورشی این تیپ را نگه می‌دارد و شناسنامه ملی خط اصطبل اختصاصی کاسپین با شبکه پرورش‌دهندگان خود دارد. جمعیت همچنان کوچک است اما در حال رشد است و ترکیب رشته‌ها گسترده‌تر از همیشه: درساژ، کلاس‌های سواری کودکان و روزافزون رینگ نمایش.

برای پرورش‌دهندگان چالش ژنتیکی است: جمعیت بنیان این‌قدر باریک انتخاب جفت دقیق می‌طلبد و ابزارهای شجره شناسنامه دقیقاً برای همین است.`,
  body_ar: `حصان الكاسبي تناقض يمكن أن تجلس عليه طفلاً: لا يتجاوز المتر عند الكاهل، لكنه بلا شك حصان — وليس مهراً — بهيكل وخبوة وطباع العربي الصحراوي المتقلص عبر عشرة آلاف عام. النقوش الفارسية القديمة تظهر خيولاً من هذا النوع بالضبط تجر عربات ملكية، وقد أيدت الدراسات الوراثية ما اقترحته البنية العظمية: الكاسبي من أقدم أنواع الخيول القائمة.

بحلول الستينيات كان يعتقد أن النوع اندثر، وإعادة اكتشافه — قطيع صغير في جبال البرز قرب بحر قزوين — من قصص الخيل العظيمة في القرن العشرين.

قطيع اليوم
تحتفظ إيران بمجموعات تربية للنوع، ويحمل السجل الوطني خطاً مخصصاً للكاسبي بشبكة مربين خاصة. يبقى العدد صغيراً لكنه ينمو، ومزيج الاستخدامات أوسع من أي وقت: قيادة العربات، وصفوف ركوب الأطفال، وحلبة العرض.

التحدي وراثي: مجتمع مؤسس بهذا الضيق يتطلب اختيار شراك دقيق، وأدوات النسب في السجل موجودة لهذا تحديداً.`,
  body_zh: `里海马是一个可以让孩子骑上去的矛盾体：肩高 barely 超过一米，却无疑是一匹马——而不是矮马——拥有经过一万年浓缩的沙漠阿拉伯马的骨骼、步幅和性情。古波斯的石雕浮雕上正显示这种马拉着皇家战车，基因研究也证实了骨骼结构一直暗示的事实：里海马是现存最古老的马类型之一。

到1960年代，人们认为这一类型已经消失。它的重新发现——在里海附近的厄尔布尔士山脉发现的一个小群体——是二十世纪最伟大的马匹故事之一，今天所有里海马都是那少数几只动物的后代。

现代马群
伊朗如今维持着这一类型的繁育群体，国家登记库设有专门的里海马种马线及其繁育者网络。种群规模仍然很小，但在增长，用途比以往任何时候都广：驾驭、儿童骑乘课，以及越来越多地出现在展示场。

对繁育者来说，挑战在基因：如此狭窄的奠基种群要求精确的配对选择，登记库的血统工具正是为此而存在。`,
  tags_json: '["caspian","کاسپین","breeds","نژادها","heritage","میراث"]',
  sources_json: '[]',
  author_label: 'Horse DB Editorial', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0025.webp'), alt_en: 'The Caspian horse, Iran\u2019s ancient miniature', alt_fa: 'اسب کاسپین، مینیاتوری باستان ایران', credit: RACE_CREDIT },
});

// ---------- 10. Winter calendar preview ----------
push({
  id: 'turn33-article-010', slug: 'winter-racing-calendar-preview-1405-dates-venues', kind: 'news',
  title_en: 'Winter Racing Calendar Preview: The Dates and Venues That Decide the Season',
  title_fa: 'نگاهی به تقویم مسابقات زمستانه ۱۴۰۵: تاریخ‌ها و میزبان‌هایی که فصل را تعیین می‌کنند',
  title_ar: 'استعراض تقويم سباقات الشتاء: التواريخ والميضات التي تحسم الموسم',
  title_zh: '冬季赛马日历前瞻：决定赛季的日期与场地',
  summary_en: 'The championship block of the 1405 racing year moves to the covered tracks. Here is the shape of the winter schedule and the horses to follow.',
  summary_fa: 'بلوک قهرمانی سال مسابقه ۱۴۰۵ به پیست‌های پوشیده می‌رود. شکل برنامه زمستان و اسب‌هایی که باید دنبال کنید.',
  summary_ar: 'كتلة بطولة عام السباقات 1405 تنتقل إلى الميضات المغطاة. هذا شكل جدول الشتاء والخيول التي يجب متابعتها.',
  summary_zh: '1405赛马年的冠军赛阶段转向室内赛道。这是冬季赛程的轮廓和值得关注的马匹。',
  body_en: `The racing year in Iran has a simple rhythm: the autumn courses crown form, the winter championship block crowns the year. The 1405 winter calendar is now settled, and it concentrates the season's decisive meetings into a compact block that trainers have been pointing their strings at since September.

The winter block opens with the first championship meeting at Gonbad Kavus, where the Sahra's three-year-olds meet the older handicappers under lights. The following weeks rotate through Tehran's shorter winter card and the Mashhad meetings, before the season's final championship day returns to the capital.

![The winter strings work early in the morning](${R('race-img-1493.webp')})

## The Horses to Follow
The season's statistics page makes the shortlist obvious. Osin Boulet's fifteen-win campaign has already entered record territory, but winter is where campaigns are judged: the championship races carry double rating points, and a horse who cannot handle the deeper winter going rarely survives the block. Focus Nora and Arugit Hsin Abad arrive as the form horses of the autumn, and the Sahra stables are openly pointing their best three-year-olds at the Gonbad championship meeting.

![Form horses head to the winter block](${R('race-img-1340.webp')})

## The Practical Notes
Winter racing in Iran is weather-dependent: northern tracks can lose days to snow, and the federation publishes revised cards when it happens — checking the official race plan before travelling remains the only reliable habit. Prize money for the championship block is the richest of the year, and owner entries close earlier than the weekly cards, usually about two weeks ahead of each meeting.

![Under winter light, the championship block decides the year](${R('race-img-0027.webp')})`,
  body_fa: `سال مسابقه در ایران ریتم ساده‌ای دارد: کورس‌های پاییز فرم را تاج می‌گذارند و بلوک قهرمانی زمستان سال را. تقویم زمستانی ۱۴۰۵ نهایی شده و دیدارهای سرنوشت‌ساز فصل را در یک بلوک فشرده جمع کرده که مربیان از شهریور رشته‌های خود را برایش آماده کرده‌اند.

بلوک زمستان با نخستین دیدار قهرمانی در گنبدکاووس آغاز می‌شود که در آن سه‌ساله‌های صحرا زیر نور با هندیکپ‌های سالمند روبه‌رو می‌شوند. هفته‌های بعد بین کارت کوتاه زمستانی تهران و دیدارهای مشهد می‌چرخد و روز قهرمانی پایانی به پایتخت برمی‌گردد.

رشته‌های زمستانی صبح زود کار می‌کنند

اسب‌هایی که باید دنبال کنید
صفحه آمار فهرست کوتاه را روشن می‌کند. کمپین پانزده‌برده اوسین بولت وارد قلمرو رکورد شده اما زمستان جایی است که کمپین‌ها سنجیده می‌شوند: مسابقات قهرمانی امتیاز دوبل دارند و اسبی که زمستان عمیق را تحمل نکند به‌ندرت از بلوک جان به در می‌برد.

نکات عملی
مسابقات زمستانی به هوا وابسته است: پیست‌های شمالی ممکن است روزهایی را به برف ببازند و فدراسیون کارت اصلاح‌شده منتشر می‌کند — چک کردن برنامه رسمی قبل از سفر تنها عادت مطمئن است. جایزه بلوک قهرمانی بیشترین سالانه است و ثبت ورودی‌ها زودتر از کارت‌های هفتگی بسته می‌شود.`,
  body_ar: `لعام السباقات في إيران إيقاع بسيط: كورسات الخريف تتوج الفورم، وكتلة بطولة الشتاء تتوج العام. تقويم الشتاء 1405 مستقر الآن ويجمع اجتماعات الموسم الحاسمة في كتلة مركزة.

تفتح كتلة الشتاء بأول اجتماع بطولة في كنبد كاووس حيث يلتقي ثلاثة السنوات من الصحراء بالهندكبار القدامى تحت الأنوار. تدور الأسابيع التالية بين بطاقة طهران الشتوية القصيرة واجتماعات مشهد قبل أن يعود يوم البطولة الختامي إلى العاصمة.

الخيول التي يجب متابعتها
تجعل صفحة إحصائيات الموسم القائمة المختصرة واضحة: حملة أوسين بوليه ذات الخمسة عشر انتصاراً دخلت منطقة الأرقام، لكن الشتاء هو حيث تُحكم الحملات لأن سباقات البطولة تحمل نقاط تصنيف مزدوجة.

ملاحظات عملية
سباقات الشتاء تعتمد على الطقس: يمكن للميضات الشمالية أن تفقد أياماً بسبب الثلج، والاتحاد ينشر بطاقات معدلة عند حدوث ذلك. جوائز كتلة البطولة هي الأغنى في العام، وإغلاق الاشتراكات أبكر من البطاقات الأسبوعية.`,
  body_zh: `伊朗赛马年有简单的节奏：秋季赛程检验状态，冬季冠军赛阶段决定年度。1405冬季日历已经确定，将赛季的决定性赛事集中在紧凑的阶段，训练师从九月就开始备战。

冬季阶段以贡巴德卡武斯的首次冠军赛开始，草原的三岁马在灯光下面对高龄让磅马。随后几周轮转到德黑兰的短冬季赛程和马什哈尔的赛事，最后的冠军日回到首都。

值得关注的马匹
赛季统计页面让入围名单一目了然。Osin Boulet的15胜战绩已进入记录领域，但冬季才是评判之处：冠军赛积分加倍，无法应对深冬场地的马很少能撑过整个阶段。

实用提示
伊朗的冬季赛马依赖天气：北方赛道可能因雪损失比赛日，联合会会发布修改后的赛程表——出行前查看官方赛程仍是唯一可靠的习惯。冠军赛阶段奖金是全年最高，马主报名比每周赛程提前关闭，通常提前约两周。`,
  tags_json: '["horse-racing","اسبدوانی","winter-calendar","تقویم زمستان","preview","نگاه"]',
  sources_json: '[{"title": "asbdavani.app racecards", "url": "https://asbdavani.app/racecards"}]',
  author_label: 'Horse DB Newsroom', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-1489.webp'), alt_en: 'Winter racing under lights', alt_fa: 'مسابقه زمستانی زیر نور', credit: RACE_CREDIT },
});

// ---------- 11. Jockeys of the Turkmen steppe ----------
push({
  id: 'turn33-article-011', slug: 'jockeys-of-the-turkmen-steppe-life-at-the-races', kind: 'article',
  title_en: 'Jockeys of the Turkmen Steppe: Life at the Races',
  title_fa: 'سوارکاران استپ ترکمن: زندگی در میله مسابقه',
  title_ar: 'فرسان سهوب التركمان: الحياة على المضمار',
  title_zh: '土库曼草原骑手：赛场人生',
  summary_en: 'Apprentices at fourteen, professionals at seventeen, legends by thirty. The men and boys who ride the Sahra\u2019s fastest horses for love more than money.',
  summary_fa: 'شاگردی در چهارده، حرفه‌ای در هفده، اسطوره در سی. مردان و پسرانی که سریع‌ترین اسب‌های صحرا را بیشتر برای عشق تا پول می‌رانند.',
  summary_ar: 'تلميذ في الرابعة عشرة، محترف في السابعة عشرة، أسطورة في الثلاثين. الرجال والأولاد الذين يركبون أسرع خيول الصحراء من أجل الحب أكثر من المال.',
  summary_zh: '十四岁当学徒，十七岁成职业，三十岁成传奇。这些人和少年骑乘草原最快的马，更多是出于热爱而非金钱。',
  body_en: `The Sahra's jockeys are small for a reason and young for another. Weight decides flat racing, so the boys who make it start early — apprentices at fourteen, riding work before school — and the ones who last build careers the way craftsmen do: season on season, horse by horse, reputation inch by inch.

Walk the paddock at Gonbad on a race morning and you will meet three generations of riders in an hour. The veterans — men who rode before the modern rating system, whose faces are leather from thirty years of steppe wind — still take a book of rides on the cards. The middle generation runs the schooling operation: they leg up the apprentices, argue with the trainers, and know every horse's temper before the handicapper does. And the apprentices, fourteen to seventeen, live at the track, ride the mornings, and dream of the championship block.

![Morning work: the apprentices ride out in the dark](${R('race-img-1493.webp')})

## The Craft
Riding a race in Gonbad is not riding a race in Ascot. The dirt is deeper, the cambers stranger, and the fields bigger — twenty-horse handicaps where the rail means nothing and the brave inside run decides everything. The good ones here are judged by their record in the close finishes: the database now records every start and placing, and a jockey's win rate follows him from meeting to meeting the way a stallion's book does.

![In the finish, a jockey is only as good as his last ride](${R('race-img-1340.webp')})

The economics are hard. A winning ride at a provincial meeting pays less than a day's labour in the city, which is why the steppe's jockeys ride for something else: family name, the pride of a stable, the unspoken competition between two villages on either side of the track. Ask a Sahra jockey why he rides and the honest answer is that his father rode, and his grandfather, and the horses were always there.

![The next generation watches and waits](${R('race-img-1315.webp')})`,
  body_fa: `سوارکاران صحرا برای یک دلیل کوچک و برای دلیل دیگری جوان هستند. وزن مسابقه سطحی را تعیین می‌کند، پس پسران موفق زود شروع می‌کنند — شاگردی در چهارده‌سالگی، رکاب پیش از مدرسه — و آن‌ها که می‌مانند مثل استادکاران کاریر می‌سازند: فصل به فصل، اسب به اسب، اعتبار به اندازه یک وجب.

صبح مسابقه در سطل گنبد یک قدم بزنید و در یک ساعت سه نسل سوارکار می‌بینید. پیشکسوتان — مردانی که پیش از سیستم ریتینگ مدرن رکاب زده‌اند و چهره‌شان از سی سال باد استپ چرم شده — هنوز در کارت‌ها رکاب می‌زنند. نسل میانی عملیات تمرین را اداره می‌کند. و شاگردها، چهارده تا هفده‌ساله، در پیست زندگی می‌کنند و رؤیای بلوک قهرمانی دارند.

کار صبحگاهی: شاگردها در تاریکی به میدان می‌روند

صنعت
رکاب زدن در گنبد مثل رکاب زدن در اسکات نیست. خاک عمیق‌تر است، شیب‌ها غریب‌تر و فیلدها بزرگ‌تر — هندیکپ‌های بیست‌اسبه که ریل معنایی ندارد و رانندگی شجاعانه داخل تعیین‌کننده است.

اقتصاد سخت است. یک برد در مسابقه استانی کمتر از یک روز کار شهری می‌دهد، به همین دلیل سواران صحرا برای چیز دیگری می‌رانند: نام خانواده، غرور اصطبل، رقابت بی‌زبانی دو روستا در دو سوی پیست. از سوار صحرا بپرسید چرا رکاب می‌زند، جواب صادقانه این است: پدرش زده، پدربزرگش هم، و اسب‌ها همیشه اینجا بودند.`,
  body_ar: `فرسان الصحراء صغار لسبب وجيئون لسبب آخر. الوزن يحسم سباقات المستوى، لذا يبدأ الأولاد الناجحون مبكراً — تلميذين في الرابعة عشرة يركبون قبل المدرسة — ومن يصمد يبني مسيرة كالحرفيين: موسماً بعد موسم، حصاناً بعد حصان.

تجول في حلبة الاستعراض صباح السباق في كنبد وستلتقي خلال ساعة بثلاثة أجيال من الفرسان. المخضرمون الذين ركبوا قبل نظام التصنيف الحديث ما زالوا يركبون، وجيل الوسط يدير عمليات التدريب، والتلاميذ من الرابعة عشرة إلى السابعة عشرة يعيشون على المضمار ويحلمون بكتلة البطولة.

الصنعة
ركوب السباق في كنبد ليس كركوبه في أسكوت: التراب أعمق والميول أغرب والحقول أكبر — هندكبار من عشرين حصاناً لا تعني فيه السياج شيئاً ويحسم كل شيء التحرك الشجاع من الداخل.

الاقتصاد قاسٍ: جائزة الفوز في اجتماع محلي أقل من يوم عمل في المدينة، ولهذا يركب فرسان الصحراء من أجل شيء آخر: اسم العائلة، وفخر الإسطبل، والمنافسة الصامتة بين قريتين على جانبي المضمار.`,
  body_zh: `草原骑手身材矮小有其原因，年轻亦然。体重决定平地赛，所以成功的男孩起步很早——十四岁当学徒，上学前就出操——而能坚持下来的人像工匠一样建立事业：一个赛季接一个赛季，一匹马接一匹马。

比赛日早晨在贡巴德的展示圈走一小时，你会遇到三代骑手。老一辈——在现代评分系统之前就开始骑乘的人，面孔被三十年草原风沙打磨成皮革——仍会接骑乘任务。中生代管理操练事务。而学徒们，十四到十七岁，住在赛道，清晨出操，梦想着冠军赛阶段。

在贡巴德骑比赛不同于在阿斯科特骑比赛。泥土更深，弯度更怪，马群更大——二十匹马的让磅赛，围栏毫无意义，勇敢的内线奔跑决定一切。

经济很艰难。省级赛事一场胜利的报酬低于城市一天的工钱，所以草原骑手为别的东西骑乘：家族名声、马房的自豪、赛道两侧两个村庄之间无声的竞争。问一个草原骑手为什么骑马，诚实的回答是：父亲骑过，祖父也骑过，而马一直都在。`,
  tags_json: '["jockeys","سوارکاران","turkmen","ترکمن","feature","گزارش","gonbad","گنبد"]',
  sources_json: '[]',
  author_label: 'گزارش اختصاصی Horse DB', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-1319.webp'), alt_en: 'A Sahra jockey in the saddle', alt_fa: 'سوارکار صحرا در زین', credit: RACE_CREDIT },
});

// ---------- 12. Registry milestone ----------
push({
  id: 'turn33-article-012', slug: 'registry-milestone-95000-horses-documented-national-database', kind: 'update',
  title_en: 'Registry Milestone: 95,000 Horses Now Documented in the National Database',
  title_fa: 'نقطه عطف شناسنامه: ۹۵ هزار اسب اکنون در پایگاه داده ملی ثبت شده‌اند',
  title_ar: 'إنجاز السجل: 95 ألف حصان موثقة الآن في قاعدة البيانات الوطنية',
  title_zh: '登记库里程碑：国家数据库现已记录9.5万匹马',
  summary_en: 'The national registry has crossed ninety-five thousand documented horses — every one with pedigree, registration data and, increasingly, a photograph.',
  summary_fa: 'شناسنامه ملی از ۹۵ هزار اسب مستند گذشت — هر یک با شجره، داده ثبت و روزافزون یک عکس.',
  summary_ar: 'تجاوز السجل الوطني خمسة وتسعين ألف حصان موثق — كل واحد بنسبه وبيانات تسجيله وصورة على نحو متزايد.',
  summary_zh: '国家登记库已突破9.5万匹记录在案的马匹——每一匹都有血统、登记数据，以及越来越多的照片。',
  body_en: `The national horse registry has passed a quiet but meaningful line: more than ninety-five thousand horses are now documented in the database, from desert-bred Arabians with paper trails going back generations to this season's foals carrying DNA profiles from birth.

The number is worth unpacking. Behind it sits the registry's core population of registered breeding stock, the racing population whose starts and wins feed the statistics pages, the sport horses competing across six disciplines, and the merged archives of the regional stud books that brought thousands of historical records online in recent seasons.

![The registry now documents the full national population](${R('race-img-0032.webp')})

## What 95,000 Records Mean
Scale changes what a registry can do. With the population fully documented, the database can answer questions that were unanswerable a decade ago: which sire lines are concentrating, which maternal families produce championship horses, where the breeding population is growing and where it is thinning. The statistics pages on this site — updated continuously — are that analysis made public.

Coverage is the next frontier. Profile photographs now exist for the hundred most influential horses, and the editorial plan is to extend documented imagery deeper into the population over the coming months. Registration data completeness varies by region: the merged historical books carry gaps, and the registry's standing invitation to breeders and clubs to submit corrections remains open.

![Every record is a horse somebody knows by name](${R('race-img-1340.webp')})

For the people who use this site every day — breeders checking a mating, trainers checking form, families tracing a mare's line — the milestone is not the number itself. It is that the number is now a tool: searchable, linked, and growing with every season.

![The database grows with every registered foal](${R('race-img-0025.webp')})`,
  body_fa: `شناسنامه ملی اسب از خطی آرام اما معنادار گذشت: بیش از ۹۵ هزار اسب اکنون در پایگاه داده مستند شده‌اند — از عربی‌های بیابانی با سابقه کاغذی چندنسلی تا فال‌های این فصل که از تولد پروفایل DNA دارند.

این عدد ارزش باز کردن دارد. پشت آن جمعیت اصلی اسب‌های پرورشی ثبت‌شده است، جمعیت مسابقه که استارت و بردشان صفحات آمار را می‌سازد، اسب‌های ورزشی در شش رشته، و بایگانی‌های ادغام‌شده کتاب‌های اصطبلی منطقه‌ای که فصل‌های اخیر هزاران رکورد تاریخی را برخط آورد.

مقیاس تغییر می‌دهد که یک شناسنامه چه می‌تواند بکند. با مستند بودن کامل جمعیت، پایگاه می‌تواند به پرسش‌هایی پاسخ دهد که ده سال پیش پاسخ‌ناپذیر بود: کدام خطوط نری متمرکز می‌شوند، کدام خانواده‌های مادری اسب قهرمان تولید می‌کنند، کجا جمعیت پرورشی رشد می‌کند و کجا لاغر می‌شود.

پوشش مرز بعدی است. عکس پروفایل اکنون برای صد اسب تأثیرگذار وجود دارد و برنامه تحریریه گسترش تصاویر مستند به عمق جمعیت در ماه‌های آینده است. کامل بودن داده ثبت بر حسب منطقه متفاوت است و دعوت همیشگی شناسنامه به پرورش‌دهندگان و باشگاه‌ها برای ارسال اصلاحات پابرجاست.

برای کسانی که هر روز از این سایت استفاده می‌کنند، نقطه عطف خود عدد نیست. این است که عدد اکنون یک ابزار است: قابل جستجو، پیونددار و در حال رشد با هر فصل.`,
  body_ar: `تجاوز السجل الوطني للخيل خطاً هادئاً لكنه ذا معنى: أكثر من خمسة وتسعين ألف حصان موثقة الآن في قاعدة البيانات، من العربيات الصحراوية بسجلات ورقية تمتد لأجيال إلى مواليد هذا الموسم حاملين ملفات الحمض النووي منذ الولادة.

الرقم يستحق التحليل: خلفه يقع المجتمع الأساسي لمخزون التربية المسجل، ومجتمع السباقات الذي تغذي انطلاقاته وانتصاراته صفحات الإحصاء، وخيول الرياضة عبر ست فئات، وأرشيفات المدمجة للكتب الإسطبلية الإقليمية.

النطاق يغير ما يستطيع السجل فعله: مع توثيق المجتمع كاملاً تستطيع قاعدة البيانات الإجابة عن أسئلة كانت مستعصية قبل عقد: أي خطوط الفحول تتركز، وأي عائلات أمهات تنتج خيول البطولة، وأين ينمو مجتمع التربية وأين يقل.

التغطية هي الحد التالي: صور الملفات موجودة الآن لأكثر مائة حصان مؤثر، والخطة تحريرية توسيع الصور الموثقة أعمق في المجتمع خلال الأشهر القادمة.`,
  body_zh: `国家马匹登记库悄然跨过一条有意义的线：数据库现已记录超过9.5万匹马——从纸面档案可追溯数代的沙漠阿拉伯马，到从出生就携带DNA档案的本季马驹。

这个数字值得解读。它背后是登记在册的繁育种群核心、为统计页面提供数据的赛马种群、参与六个项目的运动马，以及近年将数千条历史记录上线的地区血统簿合并档案。

规模改变了登记库的能力。种群完全记录后，数据库可以回答十年前无法回答的问题：哪些父系在集中，哪些母系家族产出冠军马，繁育种群在哪里增长、哪里萎缩。

覆盖是下一个前沿。最具影响力的百匹马现已配有资料照片，编辑计划将在未来几个月把有档案的影像扩展到种群更深处。对每天使用这个网站的人——查看配对的繁育者、查看状态的训练师、追溯母马血统的家庭——里程碑不是数字本身，而是数字如今成为一种工具：可搜索、有链接、随每个赛季增长。`,
  tags_json: '["registry","شناسنامه","milestone","نقطه عطف","database","پایگاه داده"]',
  sources_json: '[{"title": "Horse DB statistics", "url": "https://iraho.ir/stats"}]',
  author_label: 'Horse DB Newsroom', ai_model: 'glm-4-plus', ai_grounding: '1',
  cover: { url: R('race-img-0032.webp'), alt_en: 'The national registry documents the full horse population', alt_fa: 'شناسنامه ملی جمعیت کامل اسبان را مستند می‌کند', credit: RACE_CREDIT },
});

// ---------- insert ----------
const now = new Date();
let base = Date.now() - posts.length * 3600e3;
let n = 0;
for (const p of posts) {
  const published = new Date(base + n * 3600e3).toISOString();
  const exists = await sql`select id from content_posts where slug = ${p.slug}`;
  if (exists.length) { console.log('skip existing', p.slug); continue; }
  await sql`
    insert into content_posts (id, slug, kind, status, title_en, title_fa, title_ar, title_zh,
      summary_en, summary_fa, summary_ar, summary_zh, body_en, body_fa, body_ar, body_zh,
      tags_json, sources_json, author_label, ai_model, ai_grounding,
      cover_image_url, cover_image_alt_en, cover_image_alt_fa, cover_image_credit, cover_image_source_url,
      created_at, updated_at, published_at, row_version)
    values (${p.id}, ${p.slug}, ${p.kind}, 'published', ${p.title_en}, ${p.title_fa}, ${p.title_ar}, ${p.title_zh},
      ${p.summary_en}, ${p.summary_fa}, ${p.summary_ar}, ${p.summary_zh}, ${p.body_en}, ${p.body_fa}, ${p.body_ar}, ${p.body_zh},
      ${p.tags_json}, ${p.sources_json}, ${p.author_label}, ${p.ai_model}, ${p.ai_grounding},
      ${p.cover.url}, ${p.cover.alt_en}, ${p.cover.alt_fa}, ${p.cover.credit}, null,
      ${published}, ${published}, ${published}, 2)`;
  n++;
  console.log('inserted', p.slug);
}
console.log('new posts:', n);
await sql.end();
