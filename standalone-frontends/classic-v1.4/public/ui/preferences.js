import { state,t,fa,esc,attr,FONT_PACKS,THEME_PALETTES,setFontPack,setPalette,setAppearance,toggleDensity,resetVisualPreferences } from "./core.js";
import { SOUND_PACKS,soundState,setSoundEnabled,setSoundVolume,setSoundPack,playCue,resetSoundPreferences } from "./sound.js";

const drawer=()=>document.getElementById("preferences-drawer");
let trigger=null;

export function renderPreferences(){
  const dialog=drawer(); if(!dialog)return;
  const active=dialog.contains(document.activeElement)?document.activeElement:null;
  const focusKey=active?{id:active.id,action:active.dataset.action,value:active.dataset.value}:null;
  const scrollTop=dialog.querySelector('.preference-scroll')?.scrollTop||0;
  dialog.innerHTML=`<div class="preference-shell">
    <header class="preference-head"><div><span class="eyebrow">${esc(t("theme"))}</span><h2 id="preferences-title">${esc(t("customize"))}</h2></div><button class="drawer-close" data-action="close-preferences" aria-label="${attr(t("close"))}">×</button></header>
    <div class="preference-scroll">
      <section class="preference-section"><div class="preference-section-head"><strong>${esc(t("appearance"))}</strong><span>${esc(fa()?"مستقل از ترکیب رنگ":"Independent of color scheme")}</span></div>
        <div class="segmented" role="group" aria-label="${attr(t("appearance"))}">${["light","dark","system"].map(mode=>`<button type="button" class="segment ${state.appearance===mode?"is-active":""}" data-action="set-appearance" data-value="${mode}" aria-pressed="${state.appearance===mode}">${esc(t(mode))}</button>`).join("")}</div>
      </section>
      <section class="preference-section"><div class="preference-section-head"><strong>${esc(t("palette"))}</strong><span>${esc(fa()?"پالت‌های حرفه‌ای کم‌نور":"Low-glare professional palettes")}</span></div>
        <div class="palette-grid">${THEME_PALETTES.map(p=>`<button type="button" class="palette-option ${state.palette===p.id?"is-active":""}" data-action="set-palette" data-value="${attr(p.id)}" aria-pressed="${state.palette===p.id}"><span class="palette-swatches" aria-hidden="true">${p.swatches.map(c=>`<i style="--swatch:${attr(c)}"></i>`).join("")}</span><span>${esc(fa()?p.fa:p.en)}</span></button>`).join("")}</div>
      </section>
      <section class="preference-section"><div class="preference-section-head"><strong>${esc(t("fonts"))}</strong><span>${esc(fa()?"فونت فارسی و لاتین":"Persian + Latin typography")}</span></div>
        <label class="drawer-field"><span>${esc(t("fonts"))}</span><select id="drawer-font-pack">${FONT_PACKS.map(pack=>`<option value="${attr(pack.id)}" ${pack.id===state.fontPack?"selected":""}>${esc(fa()?pack.fa:pack.en)}</option>`).join("")}</select></label>
        <p class="preference-note">${esc(fa()?"ساحل در صورت نصب محلی استفاده می‌شود؛ وزیرمتن به‌عنوان جایگزین امن باقی می‌ماند. نستعلیق فقط برای تیترها و تاکیدهاست.":"Sahel is used when installed locally, with Vazirmatn as the safe fallback. Nastaliq remains an accent/display face rather than body copy.")}</p>
      </section>
      <section class="preference-section"><div class="preference-section-head"><strong>${esc(t("density"))}</strong><span>${esc(fa()?"برای موبایل و کار طولانی":"For phones and long work sessions")}</span></div>
        <div class="segmented" role="group" aria-label="${attr(t("density"))}"><button type="button" class="segment ${state.density==="compact"?"is-active":""}" data-action="set-density" data-value="compact" aria-pressed="${state.density==="compact"}">${esc(t("compact"))}</button><button type="button" class="segment ${state.density==="comfortable"?"is-active":""}" data-action="set-density" data-value="comfortable" aria-pressed="${state.density==="comfortable"}">${esc(t("comfortable"))}</button></div>
      </section>
      <section class="preference-section"><div class="preference-section-head"><strong>${esc(t("sounds"))}</strong><span>${esc(fa()?"صداهای کوتاه و معنادار، روشن به‌صورت پیش‌فرض":"Short semantic cues, on by default")}</span></div>
        <label class="switch-row"><span><strong>${esc(fa()?"فعال کردن صدا":"Enable sounds")}</strong><small>${esc(fa()?"مسیریابی، باز/بسته شدن، موفقیت و خطا":"Navigation, open/close, success and errors")}</small></span><input id="sound-enabled" type="checkbox" ${soundState.enabled?"checked":""}><i aria-hidden="true"></i></label>
        <label class="drawer-field"><span>${esc(t("soundPack"))}</span><select id="sound-pack" ${soundState.enabled?"":"disabled"}>${SOUND_PACKS.map(pack=>`<option value="${pack.id}" ${pack.id===soundState.pack?"selected":""}>${esc(fa()?pack.fa:pack.en)}</option>`).join("")}</select></label>
        <label class="drawer-field range-field"><span>${esc(t("volume"))}<output id="sound-volume-output">${Math.round(soundState.volume*100)}%</output></span><input id="sound-volume" type="range" min="0" max="100" step="1" value="${Math.round(soundState.volume*100)}" ${soundState.enabled?"":"disabled"}></label>
        <div class="sound-tests"><button class="btn btn-small" type="button" data-action="preview-sound" data-value="navigate" ${soundState.enabled?"":"disabled"}>${esc(t("previewSound"))} · ${esc(fa()?"مسیریابی":"Navigate")}</button><button class="btn btn-small" type="button" data-action="preview-sound" data-value="success" ${soundState.enabled?"":"disabled"}>${esc(t("previewSound"))} · ${esc(fa()?"موفق":"Success")}</button><button class="btn btn-small" type="button" data-action="preview-sound" data-value="warning" ${soundState.enabled?"":"disabled"}>${esc(t("previewSound"))} · ${esc(fa()?"هشدار":"Warning")}</button></div>
        <p class="preference-note">${esc(fa()?"سبک پیش‌فرض از کلیک ناوبری واقعی Windows 98 / Internet Explorer استفاده می‌کند؛ سبک مکانیکی نرم نیز به‌عنوان گزینه باقی مانده است.":"The default pack uses the genuine Windows 98 / Internet Explorer-style navigation click; the soft mechanical pack remains available as an alternative.")}</p>
      </section>
    </div>
    <footer class="preference-foot"><button class="btn" data-action="reset-preferences">${esc(t("resetPreferences"))}</button><button class="btn btn-primary" data-action="close-preferences">${esc(t("close"))}</button></footer>
  </div>`;
  if(focusKey){
    const replacement=[...dialog.querySelectorAll('button,input,select')].find(element=>focusKey.id?element.id===focusKey.id:element.dataset.action===focusKey.action&&element.dataset.value===focusKey.value);
    replacement?.focus({preventScroll:true});
    const scroll=dialog.querySelector('.preference-scroll');if(scroll)scroll.scrollTop=scrollTop;
  }
}

export function openPreferences(source){trigger=source||document.activeElement;renderPreferences();const dialog=drawer();trigger?.setAttribute?.("aria-expanded","true");if(!dialog?.open)dialog?.showModal();requestAnimationFrame(()=>dialog?.querySelector(".drawer-close")?.focus());playCue("open")}
export function closePreferences(){const dialog=drawer();if(dialog?.open)dialog.close();trigger?.setAttribute?.("aria-expanded","false");playCue("close");trigger?.focus?.({preventScroll:true})}

export function preferenceAction(action,el){
  if(action==="open-preferences"){openPreferences(el);return true}
  if(action==="close-preferences"){closePreferences();return true}
  if(action==="set-palette"){setPalette(el.dataset.value);playCue("click");renderPreferences();return true}
  if(action==="set-appearance"){setAppearance(el.dataset.value);playCue("click");renderPreferences();return true}
  if(action==="set-density"){if(state.density!==el.dataset.value)toggleDensity();playCue("click");renderPreferences();return true}
  if(action==="preview-sound"){playCue(el.dataset.value||"click",{force:true});return true}
  if(action==="reset-preferences"){resetVisualPreferences();resetSoundPreferences();playCue("close",{force:true});renderPreferences();return true}
  return false;
}

export function preferenceChange(el){
  if(el.id==="drawer-font-pack"){setFontPack(el.value);playCue("click");renderPreferences();return true}
  if(el.id==="sound-enabled"){setSoundEnabled(el.checked);renderPreferences();return true}
  if(el.id==="sound-pack"){setSoundPack(el.value);renderPreferences();return true}
  return false;
}
export function preferenceInput(el){
  if(el.id!=="sound-volume")return false;
  setSoundVolume(Number(el.value)/100);const out=document.getElementById("sound-volume-output");if(out)out.value=`${el.value}%`;return true;
}
