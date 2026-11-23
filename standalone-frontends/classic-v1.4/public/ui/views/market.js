import { api,state,t,fa,esc,attr,num,date,pageHead,panel,badge,loading,errorBox,kv,toast } from "../core.js";

// R76 (F08 completion): canonical marketplace listings for the Classic
// Registry app — same endpoints as every other frontend (#/api/market/*).
// Hidden prices stay hidden, nothing is presented as a valuation, and the
// inquiry form is authenticated-only (honest sign-in prompt otherwise).

const PAGE = 12;

export async function renderMarket(root) {
  const id = state.route.params.id;
  if (id) return renderListing(root, String(id));
  return renderListings(root);
}

function recordName(row) {
  const primary = fa() ? (row.name_native || row.name_latin) : (row.name_latin || row.name_native);
  return String(primary ?? "") || `#${row.id ?? "—"}`;
}

function priceText(row) {
  if (Number(row.price_visible) === 0 || row.asking_price_toman == null) return esc(t("priceNotPublished"));
  return `${num(row.asking_price_toman)} ${esc(t("toman"))}${Number(row.negotiable) === 1 ? ` · ${esc(t("negotiable"))}` : ""}`;
}

async function renderListings(root) {
  root.innerHTML = loading();
  try {
    const q = new URLSearchParams(state.route.query);
    const offset = Math.max(0, Number(q.get("offset")) || 0);
    const data = await api(`/api/market/listings?limit=${PAGE}&offset=${offset}`);
    const rows = data.rows || [];
    const total = Number(data.total) || 0;
    const table = rows.length
      ? `<div class="data-wrap"><table class="data-table"><thead><tr><th>${esc(t("listing"))}</th><th>#</th><th>${esc(t("breed"))}</th><th>${esc(t("askingPrice"))}</th><th>${esc(t("status"))}</th><th>${esc(t("listedAt"))}</th></tr></thead><tbody>${rows.map(row => `<tr>
          <td><a href="#/market/${encodeURIComponent(row.id)}" dir="auto"><strong>${esc(row.title || recordName(row))}</strong></a></td>
          <td class="mono"><a href="#/horse/${Number(row.horse_id)}">#${num(row.horse_id)}</a></td>
          <td dir="auto">${esc(row.breed_desc || "—")}</td>
          <td>${priceText(row)}</td>
          <td>${row.status === "published" ? badge(t("live"), "good") : esc(row.status)}</td>
          <td class="nowrap">${esc(date(row.listed_at))}</td>
        </tr>`).join("")}</tbody></table></div>`
      : `<div class="empty"><strong>${esc(t("noListings"))}</strong></div>`;
    const prev = offset > 0 ? `#/market?offset=${Math.max(0, offset - PAGE)}` : "";
    const next = offset + PAGE < total ? `#/market?offset=${offset + PAGE}` : "";
    const pager = `<footer class="table-footer"><span>${num(offset + 1)}–${num(Math.min(offset + PAGE, total))} ${esc(t("of"))} ${num(total)}</span><div class="cluster">${prev ? `<a class="btn btn-small" href="${attr(prev)}">${esc(t("previous"))}</a>` : ""}${next ? `<a class="btn btn-small" href="${attr(next)}">${esc(t("next"))}</a>` : ""}</div></footer>`;
    root.innerHTML = `${pageHead(t("marketplace"), t("marketIntro"), "", `<a href="#/home">${esc(t("home"))}</a><span>${esc(t("marketplace"))}</span>`)}
      ${panel(t("marketplace"), `${table}${rows.length ? pager : ""}`)}`;
  } catch (err) { root.innerHTML = errorBox(err, "reload-route"); }
}

async function renderListing(root, id) {
  root.innerHTML = loading();
  try {
    const data = await api(`/api/market/listings/${encodeURIComponent(id)}`);
    const l = data.listing || {};
    const pedigree = data.pedigree || {};
    const parents = pedigree.sire || pedigree.dam
      ? kv([
          [t("sire"), pedigree.sire ? (pedigree.sire.id ? `<a href="#/horse/${Number(pedigree.sire.id)}">${esc(fa() ? (pedigree.sire.name_native || pedigree.sire.name_latin) : (pedigree.sire.name_latin || pedigree.sire.name_native))}</a>` : esc(pedigree.sire.name_latin || "—")) : "—"],
          [t("dam"), pedigree.dam ? (pedigree.dam.id ? `<a href="#/horse/${Number(pedigree.dam.id)}">${esc(fa() ? (pedigree.dam.name_native || pedigree.dam.name_latin) : (pedigree.dam.name_latin || pedigree.dam.name_native))}</a>` : esc(pedigree.dam.name_latin || "—")) : "—"],
        ])
      : "";
    const inquiry = state.auth.user
      ? `<form id="market-inquiry-form" class="stack">
          <input type="hidden" name="listing_id" value="${attr(id)}">
          <div class="field"><label for="inquiry-name">${esc(t("yourName"))}</label><input id="inquiry-name" name="buyer_name" dir="auto" required></div>
          <div class="field"><label for="inquiry-contact">${esc(t("contact"))}</label><input id="inquiry-contact" name="buyer_contact" dir="ltr" required></div>
          <div class="field"><label for="inquiry-note">${esc(t("note"))}</label><textarea id="inquiry-note" name="message" rows="3" dir="auto"></textarea></div>
          <button class="btn btn-primary">${esc(t("sendInquiry"))}</button>
        </form>`
      : `<div class="empty"><strong>${esc(t("signIn"))}</strong><div>${esc(t("inquiryIntro"))}</div><a class="btn mt-3" href="#/account">${esc(t("signIn"))}</a></div>`;
    root.innerHTML = `${pageHead(l.title || recordName(l), `${t("listing")} · #${id}`, `<a class="btn" href="#/horse/${Number(l.horse_id)}">${esc(t("horseProfile"))}</a><a class="btn" href="#/market">${esc(t("backToMarket"))}</a>`, `<a href="#/market">${esc(t("marketplace"))}</a><span>${esc(l.title || recordName(l))}</span>`)}
      <div class="grid grid-main"><div class="stack">
        ${panel(t("listing"), kv([
          [t("askingPrice"), `<strong>${priceText(l)}</strong>`],
          [t("status"), esc(l.status)],
          [t("seller"), esc(l.seller_contact_name || "—")],
          [t("listedAt"), esc(date(l.listed_at))],
        ]))}
        ${l.description ? panel(t("description"), `<p dir="auto">${esc(l.description)}</p>`) : ""}
        ${parents ? panel(t("recordedParents"), parents) : ""}
      </div><aside class="stack">
        ${panel(t("sendInquiry"), inquiry)}
      </aside></div>`;
  } catch (err) { root.innerHTML = errorBox(err, "reload-route"); }
}

export async function submitMarketInquiry(form) {
  const d = new FormData(form);
  const id = String(d.get("listing_id") || "");
  const buyerName = String(d.get("buyer_name") || "").trim();
  const buyerContact = String(d.get("buyer_contact") || "").trim();
  const message = String(d.get("message") || "").trim();
  if (!id) throw new Error("Missing listing id");
  if (!buyerName || !buyerContact) { toast(t("inquiryRequired"), "warn"); return; }
  await api(`/api/market/listings/${encodeURIComponent(id)}/inquiries`, { method: "POST", json: { buyer_name: buyerName, buyer_contact: buyerContact, message: message || null } });
  toast(t("inquirySent"));
  form.reset();
}
