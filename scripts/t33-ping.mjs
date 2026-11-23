import pg from 'pg';
const c = new pg.Client('${process.env.SUPABASE_DATABASE_URL}');
await c.connect();
const r = await c.query('select count(*) n from horses where profile_image_url is not null');
console.log('horses with photos:', r.rows[0].n);
const p = await c.query("select count(*) n from content_posts where status='published'");
const cm = await c.query('select count(*) n from content_comments');
console.log('published posts:', p.rows[0].n, '| comments:', cm.rows[0].n);
await c.end();
