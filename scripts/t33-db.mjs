import postgres from "postgres";

export const SUPA_URL = `postgresql://postgres.gqzglbknkodyasqfrqfv:${process.env.SUPA_PW}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require`;

export function db(max = 10) {
  return postgres(SUPA_URL, { max, idle_timeout: 5, connect_timeout: 15 });
}

const sql = db();
const withPhoto = await sql`select count(*) n from horses where profile_image_url is not null`;
const posts = await sql`select count(*) n from content_posts where status='published'`;
const comments = await sql`select count(*) n from content_comments`;
console.log('horses with photos:', withPhoto[0].n, '| published posts:', posts[0].n, '| comments:', comments[0].n);
await sql.end();
