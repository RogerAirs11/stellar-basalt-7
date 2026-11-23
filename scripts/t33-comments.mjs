// Turn 33: add 500+ realistic comments across published posts (Supabase).
// Persian-dominant mix (site audience) + some English. Idempotent by id prefix cmt33.
import postgres from "postgres";

const SUPABASE_URL = process.env.SUPABASE_DATABASE_URL;
if (!SUPABASE_URL) throw new Error("Set SUPABASE_DATABASE_URL");
const sql = postgres(SUPABASE_URL, { max: 3, connect_timeout: 20 });

const FA_NAMES = ["مهدی صالحی","رضا محمدی","حسین قربانی","علی اکبر نادری","سعید کاظمی","امیر رضایی","فرهاد موسوی","ناصر جعفری","مجید احمدی","بهرام کریمی","یاسر ملکی","کاوه شریفی","حمید نوری","بهزاد امینی","آرش تهرانی","پویا صفوی","شهاب رستمی","وحید مرادی","مسعود فرهادی","جواد زارع","سینا پارسا","افشین رجبی","کریم دهقان","ایمان قاسمی","سامان یوسفی","هومن بابایی","میلاد سلطانی","نیما فتحی","آرمین کیانی","سعید برزگر","عطاالله نعمتی","مرتضی حیدری","حشمت اللهمی","خسرو امیرانی","زابل بلوچی","گل محمد ترکمن","دولت قلی یولداشوف","آقاجان نبی‌اف","یحیی گلستان","فرامرز اکبری"];
const FA_FEMALE = ["مریم حسینی","زهرا موسوی","نرگس کریمی","سارا احمدی","الهام رضایی","شیرین بهرامی","پریسا نوری","فاطمه صادقی","آیدا محمودی","نگار شفیعی","نازنین نادری","مینا کاشانی","سمانه قلی‌زاده","بهار افشار","لیلا خسروی"];
const EN_NAMES = ["Reza Hosseini","Kaveh Farzan","Arman Talebi","Sara Bahrami","Nima Rahimi","Farid Movahed","Parham Etesami","Shirin Nazari","Babak Ghaffari","Yekta Sarraf","Daniel Peterson","Mohsen Kamali","Roozbeh Amani","Azita Mehrabi","Omid Lavasani"];
const TURKMEN = ["Myrat Geldiyev","Dovran Annayev","Serdar Bazarov","Gurban Agajanov","Batyr Ovezov"];

const FA_BODIES = [
  "عکس‌ها واقعاً عالی شدن، مخصوصاً عکس‌های روز مسابقه. منتظر ادامه‌ش هستیم.",
  "من از اسب‌های پیست گنبد دیدم داشتین، دستتون درد نکنه. کارتون مثال‌زدنیه.",
  "ممنون از گزارش خوبتون. کاش اطلاعات جایزه‌های مسابقات هم بود.",
  "چه خوب که بالاخره عکس برای اسب‌های مهم گذاشتین. سال‌ها منتظر این بودم.",
  "من پرورش‌دهنده هستم، پدرم هم پرورش‌دهنده بود. این پایگاه داده برای ما یک نعمته.",
  "ای کاش شجره کامل هر اسب رو هم کنار عکس می‌ذاشتید.",
  "عکس مسابقه یزد خیلی قشنگه. پیست یزد امسال واقعاً خوب می‌چرخه.",
  "برای نریان‌ها هم عکس می‌ذارید؟ مخصوصاً نریان‌های عربی.",
  "همیشه سایتتون رو قبل از مسابقه چک می‌کنم. برنامه هفته رو زودتر بذارید لطفاً.",
  "درباره چوگان نوشتید، خیلی خوشحال شدم. ما تو اصفهان چوگان بازی می‌کنیم.",
  "این ماده عربی که تو عکس اول هست رو می‌شناسم، مال اصطبل فامیل ماست!",
  "خدا رو شکر سایت درست شد، قبلاً بعضی وقتا کند بود.",
  "نظر کسانی که تو این حوزه کار می‌کنن اینه که این سایت در آینده مرجع بشه.",
  "لطفاً درباره اسب کرد هم بیشتر بنویسید. ما تو کردستان اسب داریم.",
  "کیفیت عکس‌ها خیلی خوبه. حجمش هم کمه که رو گوشی سریع لود می‌شه.",
  "من مدیر اصطبلم، آمار فال‌ها دقیقه؟ می‌خوام برای رزرو نریان استفاده کنم.",
  "دیدگاه جالبی بود. ولی واقعیت اینه که جایزه‌ها هنوز خیلی کمه.",
  "برادر من تو مشهد مسابقه می‌ده. اسم اسبش رو تو پایگاه دیدم، خوشحال شد.",
  "قهرمانی پرش امسال که تو تهران برگزار بشه کجا گزارشش رو می‌ذارید؟",
  "چه گزارش قشنگی از گنبد. همون فضا رو توصیف کردید، دقیقاً همینه.",
  "خواندنی بود، ممنون. فقط یه غلط املایی تو پاراگراف سوم هست.",
  "من تازه‌کارم، این مطالب برای من خیلی آموزنده بود. ادامه بدید.",
  "راستش عکس‌های قدیمی سیاه‌سفید رو دوست داشتم، حس تاریخی داشت.",
  "سلام، می‌خوام اسب بخرم. کدوم استان بهتره؟",
  "اوسین بولت رو از نزدیک دیدم، واقعاً اسب بی‌نظیریه.",
  "این تحلیل جمعیت مولدها خیلی مهمه. کاش سالانه منتشرش کنید.",
  "برای ما دامپزشک‌ها بخش سلامت اسب خیلی کاربردیه.",
  "پیامک خبری دارید؟ بذارید همه بدونیم.",
  "عکس فال و مادیان قشنگ‌ترین عکس این مجموعه‌ست.",
  "تو ترکمن‌صحرا اسب بچه‌هاشو با اسم صدا می‌زنن نه با شماره، اینجا همون حس رو داره.",
];
const EN_BODIES = [
  "Great photo collection — finally the champions have faces. Keep going.",
  "I check this site before every race meeting. Please publish the cards earlier.",
  "The foundation sire analysis is superb. More of this, please.",
  "Nice feature on Gonbad. You captured the real atmosphere of the track.",
  "Can you add photos for the endurance leaders too? My horse is in the top 20!",
  "The pedigree tools here are better than what we use in the Gulf. Impressive.",
  "Caspian horses deserve more attention. Thanks for covering them.",
  "Is there an API for the registry? I'd love to build tools on top of it.",
  "Chogan piece brought back memories of Naghsh-e Jahan. Beautiful writing.",
  "Please extend photos to the top 500 horses. I want my mare's line covered.",
];
const TURKMEN_BODIES = [
  "چند ساله از پیست گنبد عکس نداشتیم، ممنون از تیم سایت.",
  "اسب ترکمن باید بیشتر دیده بشه، این عکس‌ها خوبه.",
  "ما تو بندر ترکمن هم مسابقه داریم، از ما هم عکس بگیرید.",
  "ریس‌پلن هفته رو زودتر بذارید لطفاً، سفرمون رو بر اساس اون می‌چینیم.",
];
const REPLIES_FA = [
  "کاملاً حق با شماست، ایشالله فصل بعد بیشتر می‌ذاریم.",
  "ممنون از لطفتون، این نظرات ما رو به جلو می‌بره.",
  "دقیقاً همین مشکل رو ما هم داریم.",
  "چه حرف قشنگی. آره اسب برای ما خانواده‌ست نه ماشین.",
  "منم همین رو شنیدم از اصطبل‌داری‌های قدیم.",
];

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }

const posts = await sql`SELECT id, slug, title_en FROM content_posts WHERE status='published' ORDER BY published_at DESC`;
console.log('posts:', posts.length);
const existing = await sql`SELECT post_id, count(*)::int n FROM content_comments GROUP BY post_id`;
const countMap = new Map(existing.map(e => [e.post_id, e.n]));

let batch = [];
let n = 0;
const now = Date.now();
// target: 4-9 comments per post, weighted toward recent posts
for (let pi = 0; pi < posts.length; pi++) {
  const p = posts[pi];
  const have = countMap.get(p.id) || 0;
  const target = 9 + (hash(p.slug) % 6); // 9-14
  if (have >= target) continue;
  let add = target - have;
  if (add > 6) add = 6;
  for (let k = 0; k < add; k++) {
    const h = hash(p.slug + ':' + k);
    let locale = 'fa', author, body;
    const r = h % 100;
    if (r < 8) { locale = 'en'; author = EN_NAMES[h % EN_NAMES.length]; body = EN_BODIES[(h >> 3) % EN_BODIES.length]; }
    else if (r < 12) { locale = 'fa'; author = TURKMEN[h % TURKMEN.length]; body = TURKMEN_BODIES[(h >> 3) % TURKMEN_BODIES.length]; }
    else { locale = 'fa'; author = (h % 5 === 0) ? FA_FEMALE[h % FA_FEMALE.length] : FA_NAMES[h % FA_NAMES.length]; body = FA_BODIES[(h >> 3) % FA_BODIES.length]; }
    const created = new Date(now - (pi * 7 + k * 3 + (h % 11)) * 3600e3);
    batch.push({ id: `cmt33b-${p.slug.slice(0, 40)}-${k}`, post_id: p.id, author_name: author, body, locale, likes: h % 24, created });
  }
}
console.log('new comments to insert:', batch.length);
// dedupe: skip ids that already exist
const ids = batch.map(b => b.id);
const exist = await sql`SELECT id FROM content_comments WHERE id = ANY(${ids})`;
const existSet = new Set(exist.map(e => e.id));
batch = batch.filter(b => !existSet.has(b.id));
console.log('after dedupe:', batch.length);
// insert in chunks
let inserted = 0;
for (let i = 0; i < batch.length; i += 50) {
  const chunk = batch.slice(i, i + 50);
  await sql.unsafe('INSERT INTO content_comments (id, post_id, author_name, body, locale, likes, status, created_at) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::text[], $8::timestamptz[]) ON CONFLICT (id) DO NOTHING', [chunk.map(c=>c.id), chunk.map(c=>c.post_id), chunk.map(c=>c.author_name), chunk.map(c=>c.body), chunk.map(c=>c.locale), chunk.map(c=>c.likes), chunk.map(()=> 'published'), chunk.map(c=>c.created.toISOString())]);
  inserted += chunk.length;
}
// add a few author replies
const recent = await sql`SELECT id, post_id, created_at FROM content_comments WHERE id LIKE 'cmt33-%' ORDER BY created_at DESC LIMIT 60`;
let replies = 0;
for (let i = 0; i + 1 < recent.length; i += 5) {
  const c = recent[i];
  const rid = 'cmt33-reply-' + c.id.slice(6, 40);
  await sql`INSERT INTO content_comments (id, post_id, author_name, body, locale, likes, status, created_at)
    VALUES (${rid}, ${c.post_id}, 'تحریریه Horse DB', ${REPLIES_FA[i % REPLIES_FA.length]}, 'fa', 0, 'published', ${new Date(new Date(c.created_at).getTime() + 5400e3).toISOString()})
    ON CONFLICT (id) DO NOTHING`;
  replies++;
}
const total = await sql`SELECT count(*)::int n FROM content_comments`;
console.log('inserted:', inserted, '| editorial replies:', replies, '| total comments now:', total[0].n);
await sql.end();
