-- Add cover-image provenance to editorial posts and seed a small, sourced bilingual starter newsroom.
ALTER TABLE content_posts ADD COLUMN cover_image_url TEXT;
ALTER TABLE content_posts ADD COLUMN cover_image_alt_en TEXT;
ALTER TABLE content_posts ADD COLUMN cover_image_alt_fa TEXT;
ALTER TABLE content_posts ADD COLUMN cover_image_credit TEXT;
ALTER TABLE content_posts ADD COLUMN cover_image_source_url TEXT;

INSERT OR IGNORE INTO content_posts(id,slug,kind,status,title_en,title_fa,summary_en,summary_fa,body_en,body_fa,tags_json,sources_json,cover_image_url,cover_image_alt_en,cover_image_alt_fa,cover_image_credit,cover_image_source_url,author_label,created_at,updated_at,published_at,row_version) VALUES('seed-arabian-introduction','arabian-horse-practical-introduction','article','published','The Arabian Horse: A Practical Introduction','اسب عرب؛ یک معرفی کاربردی و کوتاه','A clear first look at Arabian type, history, endurance, pedigree culture, and why the breed still matters worldwide.','یک شروع روشن برای شناخت تیپ، پیشینه، استقامت، فرهنگ تبارنامه و جایگاه امروزی اسب عرب در جهان.','## What makes an Arabian horse recognizable?
Arabian horses are known for a refined head, expressive eyes, an arched neck, a comparatively compact body and a high tail carriage. Individual horses vary, so no single feature should be used by itself to judge identity or purity.

## Built around endurance and usefulness
The breed developed under conditions where stamina, soundness, responsiveness and a close working relationship with people mattered. Those qualities helped Arabian blood influence many later riding-horse populations.

## Pedigree matters as much as appearance
Arabian-horse culture has a long tradition of recording families and bloodlines. Modern registries add formal identification, stud books and parentage controls to that tradition. A beautiful horse is not automatically a registered purebred Arabian; registry evidence and pedigree remain essential.

## Why start with the registry?
When researching an Arabian horse, begin with the registered identity: name, registration number, birth year, sex, sire and dam. Then move outward to strains, breeders, owners, descendants and performance. Horse DB is designed around that evidence-first path.','## اسب عرب را با چه ویژگی‌هایی می‌شناسیم؟
اسب عرب معمولاً با سر ظریف، چشم‌های درشت و زنده، گردن قوس‌دار، بدنی نسبتاً جمع‌وجور و بالا نگه‌داشتن دم شناخته می‌شود. البته بین اسب‌ها تفاوت طبیعی وجود دارد و هیچ ویژگی ظاهری به‌تنهایی برای تشخیص اصالت کافی نیست.

## نژادی که استقامت و کارایی در آن مهم بوده است
این اسب در شرایطی شکل گرفته که استقامت، سلامت اندام، واکنش‌پذیری و رابطه نزدیک با انسان اهمیت زیادی داشته است. همین ویژگی‌ها باعث شد خون اسب عرب بر بسیاری از جمعیت‌ها و نژادهای اسب سواری در نقاط مختلف جهان اثر بگذارد.

## تبارنامه به اندازه ظاهر اهمیت دارد
در فرهنگ اسب عرب، ثبت خانواده‌ها و خطوط خونی سابقه‌ای طولانی دارد. امروزه رجیستری‌ها این سنت را با شناسایی رسمی، دفتر انساب و کنترل والدین تکمیل می‌کنند. زیبا بودن یک اسب به‌معنای عرب اصیلِ ثبت‌شده بودن آن نیست؛ مدارک رجیستری و تبارنامه تعیین‌کننده‌اند.

## از کجا شروع کنیم؟
برای بررسی یک اسب عرب، ابتدا هویت ثبت‌شده را ببینید: نام، شماره ثبت، سال تولد، جنس، پدر و مادر. بعد سراغ تیره، پرورش‌دهنده، مالک، فرزندان و سوابق عملکردی بروید. Horse DB دقیقاً برای همین مسیرِ مبتنی بر شواهد طراحی شده است.','["Arabian horse","اسب عرب","basics","راهنما"]','[{"title":"Oklahoma State University — Arabian Horses","url":"https://breeds.okstate.edu/horses/arabian-horses"},{"title":"World Arabian Horse Organization — What is WAHO?","url":"https://www.waho.org/what-is-waho/"}]','https://upload.wikimedia.org/wikipedia/commons/5/50/Arabian_horse.jpg','Arabian horse moving in a paddock','اسب عرب در حال حرکت در محوطه باز','Renato Mitra · CC BY-SA 2.0 · Wikimedia Commons','https://commons.wikimedia.org/wiki/File:Arabian_horse.jpg','Horse DB Editorial','2026-09-10 08:00:00','2026-09-10 08:00:00','2026-09-10 08:00:00',1);

INSERT OR IGNORE INTO content_posts(id,slug,kind,status,title_en,title_fa,summary_en,summary_fa,body_en,body_fa,tags_json,sources_json,cover_image_url,cover_image_alt_en,cover_image_alt_fa,cover_image_credit,cover_image_source_url,author_label,created_at,updated_at,published_at,row_version) VALUES('seed-khuzestan-asil','khuzestan-asil-living-iranian-arabian-heritage','article','published','Khuzestan Asil Horses: A Living Iranian Arabian Heritage','اسب اصیل خوزستان؛ میراث زنده اسب عرب ایران','Why the Khuzestan Asil tradition matters, how maternal strains are remembered, and why documentation is central to preservation.','چرا سنت اسب اصیل خوزستان اهمیت دارد، تیره‌های مادری چگونه دنبال می‌شوند و چرا مستندسازی برای حفظ این میراث حیاتی است.','## More than a visual type
In Mary Gharagozlou’s account published by WAHO, the Asil horses of Khuzestan are described through known breeder families, tribes and named strains rather than appearance alone. That distinction matters: heritage is carried by documented breeding history.

## The maternal strain tradition
A notable feature of the tradition is that the foal follows the dam’s strain even when the sire comes from another accepted strain. WAHO’s historical account records Khuzestan families including Hamdani, Saglawi, Obayan, Wadnan Khersan, Hadban and Koheilan, among others.

## Preservation required documentation
The Khuzestan foundation population did not become internationally accepted merely by reputation. Pedigrees, continuity and proof of controlled breeding had to be assembled and checked. The WAHO account records the long process that led to official stud-book preparation in 1999.

## Why this matters for Horse DB
A registry database should preserve more than names. Strain terminology, maternal links, breeders, places and source quality can reveal the history behind a pedigree. That is especially important for old Iranian bloodlines, where context can be as valuable as a single number.','## موضوع فقط «ظاهر عربی» نیست
در روایت ماری قره‌گوزلو که WAHO منتشر کرده، اسب اصیل خوزستان با خانواده‌های پرورش‌دهنده شناخته‌شده، قبایل و تیره‌های نام‌دار تعریف می‌شود؛ نه فقط با ظاهر. این تفاوت مهم است، چون میراث نژادی به تاریخچه مستند تولیدمثل وابسته است.

## سنت تیره مادری
یکی از ویژگی‌های مهم این سنت آن است که کره، حتی اگر پدر از تیره دیگری باشد، تیره مادر را دنبال می‌کند. در روایت تاریخی WAHO از تیره‌هایی مانند حمدانی، صقلاوی، عبیان، ودنان خرسان، هدبان و کهیلان در خوزستان نام برده شده است.

## حفظ این میراث به سند نیاز داشت
پذیرش بین‌المللی جمعیت پایه خوزستان صرفاً بر شهرت استوار نبود. تبارنامه‌ها، پیوستگی نسل‌ها و شواهد کنترل تولیدمثل باید گردآوری و بررسی می‌شد. گزارش WAHO روند طولانی این کار را تا صدور مجوز آماده‌سازی دفتر انساب رسمی در سال ۱۹۹۹ شرح می‌دهد.

## ارتباط با Horse DB
یک پایگاه رجیستری خوب فقط نام‌ها را نگه نمی‌دارد. اصطلاحات تیره، پیوندهای مادری، پرورش‌دهندگان، محل‌ها و کیفیت منبع می‌توانند داستان پشت تبارنامه را روشن کنند؛ به‌ویژه برای خطوط خونی قدیمی ایران که زمینه تاریخی آن‌ها بسیار مهم است.','["Khuzestan","Asil","خوزستان","اسب اصیل","Iran"]','[{"title":"WAHO — Introducing the Asil Horse of Khuzestan (Iran)","url":"https://www.waho.org/introducing-the-asil-horse-of-khuzestan-iran/"},{"title":"WAHO — Iran Member Report","url":"https://www.waho.org/iran/"}]','https://upload.wikimedia.org/wikipedia/commons/9/90/Black_arabian_horse_head.jpg','Illustrative Arabian horse head; not identified as a Khuzestan Asil','تصویر نمایشی از سر یک اسب عرب؛ این اسب به‌عنوان اصیل خوزستان معرفی نشده است','OliverSeitz · Public Domain Mark · Wikimedia Commons','https://commons.wikimedia.org/wiki/File:Black_arabian_horse_head.jpg','Horse DB Editorial','2026-09-11 08:00:00','2026-09-11 08:00:00','2026-09-11 08:00:00',1);

INSERT OR IGNORE INTO content_posts(id,slug,kind,status,title_en,title_fa,summary_en,summary_fa,body_en,body_fa,tags_json,sources_json,cover_image_url,cover_image_alt_en,cover_image_alt_fa,cover_image_credit,cover_image_source_url,author_label,created_at,updated_at,published_at,row_version) VALUES('seed-iran-waho-2025','iran-arabian-horses-2025-waho-report-highlights','news','published','Iranian Arabian Horses: Highlights from the 2025 WAHO Member Report','اسب عرب ایران؛ نکات مهم گزارش ۲۰۲۵ ایران در WAHO','Iran reported roughly 1,000–1,200 registered foals per year, continued work on its next stud book, and a strong focus on preserving old Iranian bloodlines.','در گزارش ۲۰۲۵ ایران به WAHO، از حدود ۱۰۰۰ تا ۱۲۰۰ کره ثبت‌شده در سال، ادامه آماده‌سازی دفتر انساب بعدی و تأکید بر حفظ خطوط خونی قدیمی ایران گفته شد.','## Stud-book work continues
Iran’s report to the 2025 WAHO Conference said the next stud book, covering offspring born from 2021 through 2023, was being prepared for publication.

## Registration remains substantial
The report placed annual registered foal numbers at roughly 1,000 to 1,200. It also emphasized encouraging the preservation and breeding of horses carrying old Iranian bloodlines.

## Breeding technology and sport
According to the same report, artificial insemination has been used in Iran since 2016, while embryo transfer was not yet permitted and remained under discussion. Racing was described as the country’s main Arabian-horse activity, followed by halter shows and endurance.

## What to watch next
For registry users, the most useful follow-up will be the publication and incorporation of newer stud-book records. Horse DB should treat the official Iranian stud-book authority and WAHO reporting as primary reference points when newer verified data becomes available.','## کار روی دفتر انساب ادامه دارد
در گزارش ایران به کنفرانس ۲۰۲۵ WAHO آمده است که دفتر انساب بعدی، شامل نتاج متولدشده در سال‌های ۲۰۲۱ تا ۲۰۲۳، در حال آماده‌سازی برای انتشار است.

## حجم ثبت همچنان قابل توجه است
طبق این گزارش، سالانه حدود ۱۰۰۰ تا ۱۲۰۰ کره ثبت می‌شود. همچنین بر تشویق به حفظ و پرورش اسب‌های دارای خطوط خونی قدیمی ایران تأکید شده است.

## فناوری تولیدمثل و ورزش
در همان گزارش آمده که تلقیح مصنوعی از سال ۲۰۱۶ در ایران استفاده می‌شود؛ در حالی که انتقال جنین هنوز مجاز نشده و در دست بررسی است. کورس به‌عنوان فعالیت اصلی اسب عرب در کشور معرفی شده و پس از آن شوهای زیبایی (هالتر) و استقامت قرار دارند.

## بعداً چه چیزی را دنبال کنیم؟
برای کاربران رجیستری، مهم‌ترین موضوع انتشار و ورود سوابق جدید دفتر انساب است. Horse DB نیز باید هنگام دسترسی به داده‌های تازه و تأییدشده، مرجع رسمی دفتر انساب ایران و گزارش‌های WAHO را در اولویت قرار دهد.','["Iran","WAHO","2025","ایران","رجیستری"]','[{"title":"WAHO — Iran Member Report, 2025 Conference","url":"https://www.waho.org/iran/"}]','https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Arabian_horses_with_rider.jpg/1280px-Arabian_horses_with_rider.jpg','Arabian horse presented with a handler; illustrative image','اسب عرب در کنار هندلر؛ تصویر نمایشی','Yacoup almahdi · CC BY-SA 4.0 · Wikimedia Commons','https://commons.wikimedia.org/wiki/File:Arabian_horses_with_rider.jpg','Horse DB Editorial','2026-09-12 08:00:00','2026-09-12 08:00:00','2026-09-12 08:00:00',1);

INSERT OR IGNORE INTO content_posts(id,slug,kind,status,title_en,title_fa,summary_en,summary_fa,body_en,body_fa,tags_json,sources_json,cover_image_url,cover_image_alt_en,cover_image_alt_fa,cover_image_credit,cover_image_source_url,author_label,created_at,updated_at,published_at,row_version) VALUES('seed-read-pedigree','how-to-read-arabian-horse-pedigree','article','published','How to Read an Arabian Horse Pedigree Without Getting Lost','چطور تبارنامه اسب عرب را بدون سردرگمی بخوانیم؟','A simple evidence-first method: identify the horse, verify parents, move one generation at a time, then interpret strains and repeated ancestors.','یک روش ساده و مبتنی بر سند: ابتدا هویت اسب، بعد پدر و مادر، سپس نسل‌به‌نسل و در پایان تیره‌ها و اجداد تکرارشونده را بررسی کنید.','## 1. Start with identity, not the family tree
Confirm the horse’s registered name, registration number, sex and birth year first. Similar names can otherwise send you down the wrong pedigree.

## 2. Verify sire and dam
The first generation is the anchor. Check that each parent link points to the intended registered animal, especially when names have transliteration variants.

## 3. Expand one generation at a time
Do not jump immediately to a huge tree. Read parents, then grandparents, then great-grandparents. This makes missing links, duplicates and unusual repetitions easier to notice.

## 4. Separate a strain label from a parent link
A strain or family label can add historical context, but it is not a substitute for a documented parent-child relationship. Treat both as useful but different kinds of information.

## 5. Look for repeated ancestors
When the same ancestor appears on multiple branches, note where and how often. Repetition can be intentional linebreeding, a feature of a small historical population, or simply a signal that deeper pedigree analysis is worthwhile.

Horse DB’s pedigree tools are most useful when you keep this order: identity → parents → generations → repeated ancestors → broader historical interpretation.','## ۱. از هویت شروع کنید، نه از درخت بزرگ
اول نام ثبت‌شده، شماره ثبت، جنس و سال تولد اسب را بررسی کنید. شباهت نام‌ها یا تفاوت در لاتین‌نویسی می‌تواند شما را وارد تبارنامه اشتباه کند.

## ۲. پدر و مادر را تأیید کنید
نسل اول پایه بررسی تبارنامه است. مطمئن شوید هر پیوند پدر و مادر به همان اسب ثبت‌شده موردنظر اشاره می‌کند، به‌خصوص وقتی یک نام چند شکل لاتین دارد.

## ۳. نسل‌به‌نسل جلو بروید
از همان ابتدا یک درخت بسیار بزرگ باز نکنید. ابتدا والدین، بعد پدربزرگ‌ها و مادربزرگ‌ها و سپس نسل‌های بعدی را بخوانید. این روش پیدا کردن خلأها، تکرارها و پیوندهای غیرعادی را آسان‌تر می‌کند.

## ۴. «تیره» را با «پیوند والدین» یکی ندانید
نام تیره یا خانواده می‌تواند زمینه تاریخی مهمی بدهد، اما جای رابطه مستند پدر-فرزند یا مادر-فرزند را نمی‌گیرد. هر دو مفیدند، ولی دو نوع اطلاعات متفاوت هستند.

## ۵. اجداد تکرارشونده را پیدا کنید
اگر یک جد در چند شاخه دیده می‌شود، محل و تعداد تکرار را یادداشت کنید. این تکرار می‌تواند نتیجه لاین‌بریدینگ هدفمند، جمعیت تاریخی محدود یا فقط نشانه‌ای برای بررسی عمیق‌تر تبارنامه باشد.

ابزارهای تبارنامه Horse DB زمانی بیشترین ارزش را دارند که این ترتیب را حفظ کنید: هویت ← والدین ← نسل‌ها ← اجداد تکرارشونده ← تفسیر تاریخی.','["pedigree","تبارنامه","guide","registry"]','[{"title":"World Arabian Horse Organization — What is WAHO?","url":"https://www.waho.org/what-is-waho/"},{"title":"WAHO — Introducing the Asil Horse of Khuzestan (Iran)","url":"https://www.waho.org/introducing-the-asil-horse-of-khuzestan-iran/"}]','https://upload.wikimedia.org/wikipedia/commons/5/50/Arabian_horse.jpg','Arabian horse, illustrative image for pedigree guide','اسب عرب؛ تصویر نمایشی برای راهنمای تبارنامه','Renato Mitra · CC BY-SA 2.0 · Wikimedia Commons','https://commons.wikimedia.org/wiki/File:Arabian_horse.jpg','Horse DB Editorial','2026-09-13 08:00:00','2026-09-13 08:00:00','2026-09-13 08:00:00',1);

INSERT OR IGNORE INTO content_posts(id,slug,kind,status,title_en,title_fa,summary_en,summary_fa,body_en,body_fa,tags_json,sources_json,cover_image_url,cover_image_alt_en,cover_image_alt_fa,cover_image_credit,cover_image_source_url,author_label,created_at,updated_at,published_at,row_version) VALUES('seed-horsedb-newsroom','horse-db-newsroom-ai-editorial-desk-ready','update','published','Horse DB Update: Newsroom and AI Editorial Desk Are Ready','به‌روزرسانی Horse DB؛ اتاق خبر و میز تحریریه هوش مصنوعی آماده است','Horse DB now includes bilingual editorial publishing, sourced cover images, post types, and an optional Gemini-assisted workflow for administrators.','Horse DB اکنون انتشار دو زبانه، تصویر شاخص دارای منبع، انواع مطلب و فرایند اختیاری تولید محتوا با Gemini برای مدیران را در خود دارد.','## A real publishing space inside the registry
The new Newsroom brings articles, news and product updates into one bilingual destination. Readers can filter by content type and switch language without creating duplicate posts.

## Admins can write manually or use AI
The editorial desk supports normal manual editing as well as Gemini-assisted generation. The AI workflow requests English and Persian together in one structured response, validates the result, and can keep it as a draft or publish it immediately.

## Grounding is optional
When Google Search grounding is enabled, the AI workflow is instructed to use current web evidence and Horse DB stores the returned source links with the post. Administrators can keep grounding off for evergreen or internal updates.

## Images keep their provenance
Cover images can carry alt text, photographer/license credit and a source-page link. The starter posts use openly licensed Wikimedia Commons images and retain attribution information.

This feature is intended to demonstrate that a registry can be both a structured database and an active knowledge surface without mixing editorial text into canonical horse records.','## یک فضای واقعی انتشار داخل رجیستری
اتاق خبر جدید، مقاله‌ها، خبرها و به‌روزرسانی‌های خود سامانه را در یک مقصد دو زبانه جمع می‌کند. خواننده می‌تواند نوع محتوا را فیلتر کند و بدون ساخت دو مطلب جداگانه، زبان را تغییر دهد.

## مدیر می‌تواند دستی بنویسد یا از هوش مصنوعی کمک بگیرد
میز تحریریه هم ویرایش دستی معمولی را دارد و هم تولید محتوا با کمک Gemini را. در حالت هوش مصنوعی، متن انگلیسی و فارسی در یک پاسخ ساختاریافته تولید و اعتبارسنجی می‌شود و سپس می‌توان آن را به‌صورت پیش‌نویس نگه داشت یا بلافاصله منتشر کرد.

## اتصال به جست‌وجوی گوگل اختیاری است
اگر Google Search Grounding روشن باشد، فرایند هوش مصنوعی از شواهد وب روز استفاده می‌کند و لینک منابع برگشتی نیز همراه مطلب در Horse DB ذخیره می‌شود. برای مطالب ماندگار یا اطلاعیه‌های داخلی می‌توان Grounding را خاموش گذاشت.

## منبع تصویر هم حفظ می‌شود
برای تصویر شاخص می‌توان متن جایگزین، نام عکاس یا مجوز و لینک صفحه منبع را ذخیره کرد. مطالب اولیه از تصاویر دارای مجوز آزاد در Wikimedia Commons استفاده می‌کنند و اطلاعات انتساب را نگه می‌دارند.

هدف این قابلیت این است که رجیستری در کنار یک پایگاه داده ساختاریافته، یک سطح دانشی زنده هم باشد؛ بدون آنکه محتوای تحریریه با رکوردهای رسمی اسب‌ها مخلوط شود.','["Horse DB","update","Newsroom","AI","به‌روزرسانی"]','[]','https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Arabian_horses_with_rider.jpg/1280px-Arabian_horses_with_rider.jpg','Arabian horse with handler, used as an illustrative Newsroom cover','اسب عرب در کنار هندلر؛ تصویر شاخص نمایشی برای اتاق خبر','Yacoup almahdi · CC BY-SA 4.0 · Wikimedia Commons','https://commons.wikimedia.org/wiki/File:Arabian_horses_with_rider.jpg','Horse DB Editorial','2026-09-14 08:00:00','2026-09-14 08:00:00','2026-09-14 08:00:00',1);
