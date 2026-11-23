import { preferenceStorage } from "./storage.js";
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));

export const SOUND_PACKS=Object.freeze([
  {id:"win98",en:"Windows 98 / IE navigation",fa:"ویندوز ۹۸ / کلیک اینترنت اکسپلورر"},
  {id:"soft",en:"Soft mechanical",fa:"مکانیکی نرم"},
]);

const savedPack=preferenceStorage.getItem("registry.soundPack");
const savedEnabled=preferenceStorage.getItem("registry.soundEnabled");
// R29.29 changes the shipped default from silent synthetic Retro to audible Win98.
// Migrate only the legacy default-shaped state; explicit non-Retro user choices stay intact.
const legacySilentDefault=(savedEnabled===null)||(savedEnabled==="false"&&(!savedPack||savedPack==="retro"));
export const soundState={
  enabled:legacySilentDefault?true:savedEnabled!=="false",
  volume:clamp(Number(preferenceStorage.getItem("registry.soundVolume")??0.34),0,1),
  pack:SOUND_PACKS.some(x=>x.id===savedPack)?savedPack:"win98",
};
if(legacySilentDefault){
  preferenceStorage.setItem("registry.soundEnabled","true");
  if(!savedPack||savedPack==="retro")preferenceStorage.setItem("registry.soundPack","win98");
}

let context=null;
function audio(){
  const AudioContext=window.AudioContext||window.webkitAudioContext;
  if(!AudioContext)return null;
  if(!context)context=new AudioContext();
  if(context.state==="suspended")context.resume().catch(()=>{});
  return context;
}

const win98StartUrl=new URL("./sounds/START.WAV",import.meta.url).href;
const win98Prototype=typeof Audio!=="undefined"?new Audio(win98StartUrl):null;
if(win98Prototype)win98Prototype.preload="auto";
const liveSamples=new Set();

function playWin98Sample({rate=1,gain=1,delay=0}={}){
  if(!win98Prototype)return;
  const run=()=>{
    try{
      const a=win98Prototype.cloneNode(true);
      a.preload="auto";
      a.volume=clamp(soundState.volume*gain,0,1);
      a.playbackRate=clamp(rate,.55,1.5);
      liveSamples.add(a);
      const clean=()=>liveSamples.delete(a);
      a.addEventListener("ended",clean,{once:true});
      a.addEventListener("error",clean,{once:true});
      const p=a.play(); if(p?.catch)p.catch(clean);
    }catch{}
  };
  if(delay>0)window.setTimeout(run,delay);else run();
}
function win98(kind){
  // START.WAV is the genuine classic Explorer / IE-style navigation click.
  // Semantic cues stay short; only playback-rate/spacing changes, never synthetic replacement tones.
  const map={
    click:[{rate:1.00,gain:.90}],
    navigate:[{rate:1.00,gain:1.00}],
    open:[{rate:1.08,gain:.90}],
    close:[{rate:.92,gain:.82}],
    success:[{rate:1.00,gain:.88},{rate:1.20,gain:.68,delay:82}],
    warning:[{rate:.84,gain:.88},{rate:.84,gain:.72,delay:132}],
    error:[{rate:.67,gain:.95}],
  };
  for(const spec of map[kind]||map.click)playWin98Sample(spec);
}

export function setSoundEnabled(enabled){
  soundState.enabled=Boolean(enabled);
  preferenceStorage.setItem("registry.soundEnabled",String(soundState.enabled));
  if(soundState.enabled)playCue("open",{force:true});
}
export function setSoundVolume(value){
  soundState.volume=clamp(Number(value),0,1);
  preferenceStorage.setItem("registry.soundVolume",String(soundState.volume));
}
export function setSoundPack(pack){
  soundState.pack=SOUND_PACKS.some(x=>x.id===pack)?pack:"win98";
  preferenceStorage.setItem("registry.soundPack",soundState.pack);
  playCue("click",{force:true});
}

function tone(ctx,at,{frequency=440,duration=.05,type="sine",gain=.14,endFrequency=null}){
  const osc=ctx.createOscillator();
  const amp=ctx.createGain();
  osc.type=type;
  osc.frequency.setValueAtTime(frequency,at);
  if(endFrequency)osc.frequency.exponentialRampToValueAtTime(Math.max(20,endFrequency),at+duration);
  const level=clamp(gain*soundState.volume,0,.18);
  amp.gain.setValueAtTime(.0001,at);
  amp.gain.exponentialRampToValueAtTime(Math.max(.0002,level),at+.006);
  amp.gain.exponentialRampToValueAtTime(.0001,at+duration);
  osc.connect(amp);amp.connect(ctx.destination);
  osc.start(at);osc.stop(at+duration+.012);
}
function soft(ctx,kind){
  const t=ctx.currentTime+.004;
  const map={click:[[720,.025]],navigate:[[430,.04],[610,.045,.045]],open:[[480,.05],[640,.05,.05]],close:[[600,.04],[420,.05,.04]],success:[[520,.05],[690,.07,.05]],warning:[[360,.08],[330,.08,.1]],error:[[220,.12]]};
  for(const [frequency,duration,delay=0] of map[kind]||map.click)tone(ctx,t+delay,{frequency,duration,type:"sine",gain:.06});
}

export function playCue(kind="click",options={}){
  if(!soundState.enabled&&!options.force)return;
  if(soundState.pack==="win98"){win98(kind);return}
  const ctx=audio();if(!ctx)return;
  try{soft(ctx,kind)}catch{}
}

export function resetSoundPreferences(){
  soundState.enabled=true;
  soundState.volume=.34;
  soundState.pack="win98";
  for(const key of ["registry.soundEnabled","registry.soundVolume","registry.soundPack"])preferenceStorage.removeItem(key);
}
