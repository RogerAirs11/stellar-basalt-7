const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB = `https://api.cloudflare.com/client/v4/accounts/d75bc9215eaa1c0fc53b7f716195fdfc/d1/database/f527d88f-c274-4a11-8d17-37dc43ba9027/query`;
const res = await fetch(DB, { method: 'POST', headers: { Authorization: 'Bearer ' + CF_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: "UPDATE content_posts SET cover_image_url='/images/races/race-img-1319.webp' WHERE cover_image_url='/images/races/race-img-0034.webp'" }) });
console.log((await res.json()).success ? 'D1 cover fixed' : 'D1 fix failed');
