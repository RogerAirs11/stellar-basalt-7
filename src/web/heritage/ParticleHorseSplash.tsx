import { type UiLocale, uiText, isUiRtl } from "../../shared/uiLocale";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { getHeritageVisualAssets, subscribeHeritageVisualAssets } from "../heritageVisualAssets"
// Original optional self-hosted three.js Horse.glb (mrdoob/three.js r180).
// Its source archive omission disables this splash until the approved model
// and its provenance are restored. No third-party fallback fetch is attempted.
import { PARTICLE_HORSE_MODEL_URL } from "../assetCatalog"

type Locale=UiLocale
type Vec3={x:number;y:number;z:number}
type GlbAccessor={bufferView?:number;byteOffset?:number;componentType:number;count:number;type:string;normalized?:boolean}
type GlbBufferView={byteOffset?:number;byteLength:number;byteStride?:number}
type GlbPrimitive={attributes:Record<string,number>;indices?:number;targets?:Array<Record<string,number>>;mode?:number}
type GlbMesh={primitives:GlbPrimitive[];weights?:number[]}
type GlbAnimationSampler={input:number;output:number;interpolation?:"LINEAR"|"STEP"|"CUBICSPLINE"}
type GlbAnimationChannel={sampler:number;target:{node?:number;path:string}}
type GlbAnimation={samplers:GlbAnimationSampler[];channels:GlbAnimationChannel[]}
type GlbJson={accessors:GlbAccessor[];bufferViews:GlbBufferView[];meshes:GlbMesh[];animations?:GlbAnimation[];nodes?:Array<{mesh?:number;weights?:number[]}>}
type HorseModel={base:Float32Array;morphs:Float32Array[];indices:Uint32Array;weightsDefault:Float32Array;animation:MorphAnimation|null;vertexCount:number}
type MorphAnimation={times:Float32Array;values:Float32Array;interpolation:"LINEAR"|"STEP"|"CUBICSPLINE";morphCount:number;duration:number}
type ParticleSurface={
  triA:Uint32Array;triB:Uint32Array;triC:Uint32Array;ba:Float32Array;bb:Float32Array;bc:Float32Array;
  triA2:Uint32Array;triB2:Uint32Array;triC2:Uint32Array;ba2:Float32Array;bb2:Float32Array;bc2:Float32Array;
  seed:Float32Array;scale:Float32Array;orbitBase:Float32Array;link:Uint32Array;group:Uint16Array;count:number;groupCount:number
}
type Shockwave={origin:Vec3;started:number;strength:number}
type Vortex={origin:Vec3;started:number;duration:number;spin:number}
type ParticleHorseTuning={
  spill:number;horseScale:number;horseOffsetX:number;particleMin:number;particleMedian:number;particleMax:number;coreSize:number;dustSize:number;
  smallBrightness:number;largeBrightness:number;brightnessRandomness:number;overallBrightness:number;saturation:number;palette:number;winkDepth:number;winkSpeed:number;winkSpeedRandomness:number;winkSizeBias:number;
  bloomRadius:number;bloomStrength:number;fineBloomRadius:number;fineBloomStrength:number;fineBloomThreshold:number;auraStrength:number;motionBlurStrength:number;motionBlurSpread:number;attraction:number;damping:number;jitter:number;pointerForce:number;pointerRadius:number;
  waveStrength:number;waveRadius:number;vortexStrength:number;vortexDuration:number;collisionAcoustics:number;
  noiseFloor:number;noiseActiveMin:number;noiseMax:number;noiseIdleCutoff:number;noiseActiveCutoff:number;noiseResponse:number;noiseRelease:number;noiseMotionSensitivity:number;noiseChaosSensitivity:number;
  chimeVolume:number;lowChimeBias:number;chimeMinDelay:number;chimeChordFocus:number;
  passiveChimeEnabled:number;passiveChimeRate:number;passiveChimeVolume:number;passiveChimeOctaveBias:number;passiveChimeResponse:number;
  activeChimeEnabled:number;activeChimeMinRate:number;activeChimeRate:number;activeChimeMinVolume:number;activeChimeVolume:number;activeChimeOctaveBias:number;activeChimeResponse:number;activeActivityContrast:number;
  sweepChimeEnabled:number;sweepChimeRate:number;sweepChimeVolume:number;sweepChimeOctaveBias:number;sweepChimeSpan:number;sweepContactSensitivity:number;
  bassVolume:number;bassOctave:number;bassWave:number;padVolume:number;padOctave:number;padTimbre:number;
  musicRate:number;reverb:number;progression:number;harmonyGlide:number;chimeAdoptionPoint:number;registerOpenness:number;chimeMinOctave:number;chimeMaxOctave:number;
}
type AudioEngine={arm:()=>void;step:(motionActivity:number,userInteraction:number,orbit:number,collisionSignature:number,collisionMultiplicity:number,pointerContact:number,pointerPosition:number,pointerSpeed:number)=>void;trigger:(kind:"wave"|"vortex"|"spark",x:number,intensity:number)=>void;idle:()=>void;configure:(tuning:ParticleHorseTuning)=>void;dispose:()=>void}
type Props={locale:Locale;cameraOrbit?:number}

type SliderSpec={key:keyof ParticleHorseTuning;label:string;labelFa:string;min:number;max:number;step:number;unit?:string}
type SelectOption={value:number;label:string;labelFa:string}
type SelectSpec={key:keyof ParticleHorseTuning;label:string;labelFa:string;options:SelectOption[];hint?:string;hintFa?:string}
const TUNING_STORAGE_KEY="horse-db-particle-horse-tuning-v5"
const MUSIC_PROGRESSION_OPTIONS=[
  {label:"Celestial",labelFa:"آسمانی"},
  {label:"Neo-classical",labelFa:"نئوکلاسیک"},
  {label:"Lydian dream",labelFa:"رویای لیدین"},
  {label:"Nocturne jazz",labelFa:"جاز شبانه"},
  {label:"Minimal glass",labelFa:"مینیمال شیشه‌ای"},
  {label:"Dorian meditation",labelFa:"مدیتیشن دورین"},
] as const

// R29.17 remains available as an explicit historical preset. The built-in
// default/reset profile is the latest user-approved exported tuning profile.
const HERITAGE_TUNING:ParticleHorseTuning={
  spill:0,horseScale:1,horseOffsetX:0,particleMin:.48,particleMedian:.90,particleMax:1.32,coreSize:1,dustSize:1,
  smallBrightness:1,largeBrightness:1,brightnessRandomness:0,overallBrightness:1,saturation:1,palette:0,winkDepth:0,winkSpeed:1,winkSpeedRandomness:0,winkSizeBias:0,
  bloomRadius:1,bloomStrength:1,fineBloomRadius:.92,fineBloomStrength:.88,fineBloomThreshold:.95,auraStrength:1,motionBlurStrength:.12,motionBlurSpread:1.08,attraction:1,damping:1,jitter:1,pointerForce:1,pointerRadius:1,
  waveStrength:1,waveRadius:1,vortexStrength:1,vortexDuration:1,collisionAcoustics:1,
  noiseFloor:.70,noiseActiveMin:0,noiseMax:1,noiseIdleCutoff:560,noiseActiveCutoff:4800,noiseResponse:1.10,noiseRelease:.16,noiseMotionSensitivity:1,noiseChaosSensitivity:1.15,
  chimeVolume:1,lowChimeBias:1,chimeMinDelay:.035,chimeChordFocus:.88,
  passiveChimeEnabled:1,passiveChimeRate:1,passiveChimeVolume:.55,passiveChimeOctaveBias:-.12,passiveChimeResponse:1.05,
  activeChimeEnabled:1,activeChimeMinRate:0,activeChimeRate:5.2,activeChimeMinVolume:0,activeChimeVolume:.92,activeChimeOctaveBias:.18,activeChimeResponse:1,activeActivityContrast:1,
  sweepChimeEnabled:0,sweepChimeRate:1.05,sweepChimeVolume:.58,sweepChimeOctaveBias:.22,sweepChimeSpan:2.4,sweepContactSensitivity:1,
  bassVolume:.66,bassOctave:0,bassWave:0,padVolume:1.10,padOctave:1,padTimbre:0,
  musicRate:1,reverb:1,progression:0,harmonyGlide:1,chimeAdoptionPoint:.50,registerOpenness:1,chimeMinOctave:2,chimeMaxOctave:7,
}
const DEFAULT_TUNING:ParticleHorseTuning={
  spill:0,horseScale:1.18,horseOffsetX:0.25,particleMin:0.42,particleMedian:0.75,particleMax:1.36,coreSize:0.77,dustSize:1.28,
  smallBrightness:5.8,largeBrightness:1.25,brightnessRandomness:0.39,overallBrightness:1.01,saturation:6,palette:0,winkDepth:1.8,winkSpeed:6.56,winkSpeedRandomness:1.04,winkSizeBias:0.12,
  bloomRadius:0.1,bloomStrength:1.79,fineBloomRadius:0.01,fineBloomStrength:2.95,fineBloomThreshold:1.01,auraStrength:0.18,motionBlurStrength:1.59,motionBlurSpread:0.68,attraction:1,damping:1,jitter:1,pointerForce:1,pointerRadius:1,
  waveStrength:1,waveRadius:1,vortexStrength:1,vortexDuration:1,collisionAcoustics:0.57,
  noiseFloor:0,noiseActiveMin:0,noiseMax:2.64,noiseIdleCutoff:210,noiseActiveCutoff:6150,noiseResponse:2.8,noiseRelease:0.1,noiseMotionSensitivity:0,noiseChaosSensitivity:1.53,
  chimeVolume:0.84,lowChimeBias:1.34,chimeMinDelay:0,chimeChordFocus:1,
  passiveChimeEnabled:1,passiveChimeRate:3,passiveChimeVolume:1.8,passiveChimeOctaveBias:-0.25,passiveChimeResponse:0.87,
  activeChimeEnabled:1,activeChimeMinRate:1.03,activeChimeRate:30,activeChimeMinVolume:0,activeChimeVolume:1.27,activeChimeOctaveBias:0.76,activeChimeResponse:1.24,activeActivityContrast:0.58,
  sweepChimeEnabled:1,sweepChimeRate:3,sweepChimeVolume:0.39,sweepChimeOctaveBias:1,sweepChimeSpan:3.55,sweepContactSensitivity:3.03,
  bassVolume:0.93,bassOctave:0,bassWave:2,padVolume:1.1,padOctave:1,padTimbre:0,
  musicRate:1.65,reverb:1.36,progression:0,harmonyGlide:0.35,chimeAdoptionPoint:0.1,registerOpenness:1,chimeMinOctave:3,chimeMaxOctave:7,
}
const TUNING_PRESETS:Record<string,ParticleHorseTuning>={
  approved:{...DEFAULT_TUNING},
  heritage:{...HERITAGE_TUNING},
  cinematic:{...HERITAGE_TUNING,spill:1,coreSize:1.04,palette:1,saturation:1.14,overallBrightness:1.06,bloomRadius:1.24,bloomStrength:1.22,fineBloomRadius:1.05,fineBloomStrength:1.34,fineBloomThreshold:.86,auraStrength:1.16,motionBlurStrength:.22,motionBlurSpread:1.20,winkDepth:.22,brightnessRandomness:.10,pointerForce:1.16,waveStrength:1.18,vortexStrength:1.18,noiseFloor:.44,noiseActiveMin:0,noiseMax:1.36,noiseActiveCutoff:6600,noiseRelease:.16,noiseMotionSensitivity:1.05,noiseChaosSensitivity:1.28,passiveChimeRate:1.06,passiveChimeVolume:.56,passiveChimeOctaveBias:-.06,activeChimeMinRate:0,activeChimeRate:6.2,activeChimeMinVolume:0,activeChimeVolume:1.08,activeChimeOctaveBias:.20,reverb:1.18},
  aurora:{...HERITAGE_TUNING,palette:1,saturation:1.26,smallBrightness:1.16,largeBrightness:.90,brightnessRandomness:.16,winkDepth:.32,winkSpeed:.82,bloomRadius:1.30,bloomStrength:1.20,fineBloomRadius:.98,fineBloomStrength:1.28,fineBloomThreshold:.80,auraStrength:1.18,motionBlurStrength:.14,motionBlurSpread:1.10,noiseFloor:.38,noiseActiveMin:0,noiseMax:1.10,noiseIdleCutoff:610,noiseActiveCutoff:5600,noiseRelease:.18,passiveChimeRate:1.22,passiveChimeVolume:.48,passiveChimeOctaveBias:.08,activeChimeMinRate:0,activeChimeRate:4.8,activeChimeMinVolume:0,activeChimeVolume:.90,activeChimeOctaveBias:.32,reverb:1.15},
  meditative:{...HERITAGE_TUNING,spill:.62,palette:4,saturation:.90,bloomRadius:1.18,bloomStrength:1.08,fineBloomRadius:.86,fineBloomStrength:.78,fineBloomThreshold:1.02,auraStrength:1.08,motionBlurStrength:.10,motionBlurSpread:1.08,winkDepth:.28,winkSpeed:.72,attraction:.88,jitter:.74,pointerForce:.78,waveStrength:.76,vortexStrength:.82,noiseFloor:.26,noiseActiveMin:0,noiseMax:.70,noiseIdleCutoff:420,noiseActiveCutoff:3400,noiseResponse:1.42,noiseRelease:.22,noiseMotionSensitivity:.92,noiseChaosSensitivity:.88,passiveChimeRate:.82,passiveChimeVolume:.42,passiveChimeOctaveBias:-.22,passiveChimeResponse:1.24,activeChimeMinRate:0,activeChimeRate:2.8,activeChimeMinVolume:0,activeChimeVolume:.74,activeChimeOctaveBias:.02,activeChimeResponse:.82,bassVolume:.54,padVolume:1.15,musicRate:.72,reverb:1.20},
  reactive:{...HERITAGE_TUNING,palette:2,saturation:1.12,brightnessRandomness:.12,winkDepth:.20,fineBloomRadius:.92,fineBloomStrength:1.22,fineBloomThreshold:.82,motionBlurStrength:.28,motionBlurSpread:1.24,spill:1,pointerForce:1.42,pointerRadius:1.18,waveStrength:1.44,waveRadius:1.16,vortexStrength:1.46,vortexDuration:1.24,collisionAcoustics:1.28,noiseFloor:.30,noiseActiveMin:0,noiseMax:1.92,noiseIdleCutoff:560,noiseActiveCutoff:8000,noiseResponse:.82,noiseRelease:.11,noiseMotionSensitivity:1.22,noiseChaosSensitivity:1.72,passiveChimeRate:1.40,passiveChimeVolume:.54,activeChimeMinRate:0,activeChimeRate:9.4,activeChimeMinVolume:0,activeChimeVolume:1.18,activeChimeOctaveBias:.35,activeChimeResponse:1.45,sweepChimeEnabled:1,sweepChimeRate:1.55,sweepChimeVolume:.52,sweepChimeOctaveBias:.36},
  minimal:{...HERITAGE_TUNING,spill:.42,particleMedian:.84,particleMax:1.12,coreSize:.90,dustSize:.78,palette:5,saturation:.72,bloomRadius:.82,bloomStrength:.76,fineBloomRadius:.74,fineBloomStrength:.56,fineBloomThreshold:1.12,auraStrength:.70,motionBlurStrength:.06,motionBlurSpread:1.02,winkDepth:.14,jitter:.72,noiseFloor:.16,noiseActiveMin:0,noiseMax:.50,noiseIdleCutoff:340,noiseActiveCutoff:2600,noiseResponse:1.56,noiseRelease:.18,noiseMotionSensitivity:.82,noiseChaosSensitivity:.78,passiveChimeRate:.58,passiveChimeVolume:.32,passiveChimeOctaveBias:-.30,activeChimeMinRate:0,activeChimeRate:2.1,activeChimeMinVolume:0,activeChimeVolume:.62,activeChimeOctaveBias:-.04,activeChimeResponse:.72,bassVolume:.48,padVolume:.82,reverb:.82},
}
const PRESET_OPTIONS=[
  {value:"approved",label:"Current approved default",labelFa:"پیش‌فرض تأییدشده فعلی"},
  {value:"heritage",label:"Heritage original · R29.17",labelFa:"ظاهر اصلی · R29.17"},
  {value:"cinematic",label:"Cinematic astral",labelFa:"سینمایی آسمانی"},
  {value:"aurora",label:"Aurora shimmer",labelFa:"درخشش شفق"},
  {value:"meditative",label:"Meditative",labelFa:"مدیتیشن"},
  {value:"reactive",label:"Reactive energy",labelFa:"انرژی واکنشی"},
  {value:"minimal",label:"Minimal",labelFa:"مینیمال"},
] as const

const SIZE_SLIDERS:SliderSpec[]=[
  {key:"horseScale",label:"Horse size",labelFa:"اندازه اسب",min:.35,max:2.35,step:.01},
  {key:"horseOffsetX",label:"Horse horizontal shift",labelFa:"جابجایی افقی اسب",min:-1.5,max:1.5,step:.01},
  {key:"particleMin",label:"Smallest particle",labelFa:"کوچک‌ترین ذره",min:.18,max:.95,step:.01},
  {key:"particleMedian",label:"Median particle",labelFa:"اندازه میانه",min:.38,max:1.45,step:.01},
  {key:"particleMax",label:"Largest particle",labelFa:"بزرگ‌ترین ذره",min:.60,max:2.25,step:.01},
  {key:"coreSize",label:"Surface scale",labelFa:"مقیاس سطح",min:.35,max:1.90,step:.01},
  {key:"dustSize",label:"Ambient dust size",labelFa:"اندازه غبار محیطی",min:.25,max:2.20,step:.01},
]
const LIGHT_SLIDERS:SliderSpec[]=[
  {key:"overallBrightness",label:"Master brightness",labelFa:"روشنایی کلی",min:0,max:4.50,step:.01},
  {key:"saturation",label:"Color saturation",labelFa:"اشباع رنگ",min:0,max:10.00,step:.01},
  {key:"smallBrightness",label:"Small-particle light",labelFa:"نور ذرات کوچک",min:.20,max:10.50,step:.01},
  {key:"largeBrightness",label:"Large-particle light",labelFa:"نور ذرات بزرگ",min:.10,max:4.50,step:.01},
  {key:"brightnessRandomness",label:"Brightness randomness",labelFa:"تصادفی‌بودن روشنایی",min:0,max:2.00,step:.01},
  {key:"winkDepth",label:"Wink / blackout depth",labelFa:"عمق سو‌سو / خاموشی",min:0,max:5.20,step:.01},
  {key:"winkSpeed",label:"Wink speed",labelFa:"سرعت سو‌سو",min:.10,max:8.50,step:.01},
  {key:"winkSpeedRandomness",label:"Wink speed variation",labelFa:"تنوع سرعت سو‌سو",min:0,max:1.50,step:.01},
  {key:"winkSizeBias",label:"Wink size bias · small ↔ large",labelFa:"گرایش سو‌سو · کوچک ↔ بزرگ",min:-1,max:1,step:.01},
]
const BLOOM_SLIDERS:SliderSpec[]=[
  {key:"bloomRadius",label:"Global bloom radius",labelFa:"شعاع بلوم کلی",min:.10,max:3.60,step:.01},
  {key:"bloomStrength",label:"Global bloom intensity",labelFa:"شدت بلوم کلی",min:0,max:4.80,step:.01},
  {key:"fineBloomRadius",label:"Optical bloom radius",labelFa:"شعاع بلوم اپتیکی",min:.01,max:8.40,step:.01},
  {key:"fineBloomStrength",label:"Optical bloom intensity",labelFa:"شدت بلوم اپتیکی",min:0,max:12.00,step:.01},
  {key:"fineBloomThreshold",label:"Optical bloom threshold",labelFa:"آستانه بلوم اپتیکی",min:0,max:4.50,step:.01},
  {key:"auraStrength",label:"Field aura",labelFa:"هاله میدان",min:0,max:5.50,step:.01},
  {key:"motionBlurStrength",label:"Motion blur",labelFa:"محو حرکتی",min:0,max:4.80,step:.01},
  {key:"motionBlurSpread",label:"Motion trail softness",labelFa:"نرمی رد حرکتی",min:.15,max:6.00,step:.01},
]
const FIELD_SLIDERS:SliderSpec[]=[
  {key:"spill",label:"Hero-field freedom",labelFa:"آزادی در کل قاب",min:0,max:1,step:.01},
  {key:"attraction",label:"Surface attraction",labelFa:"جذب به سطح",min:.45,max:1.65,step:.01},
  {key:"damping",label:"Damping",labelFa:"میرایی",min:.45,max:1.65,step:.01},
  {key:"jitter",label:"Micro motion",labelFa:"ریزحرکت",min:.25,max:1.75,step:.01},
]
const INTERACTION_SLIDERS:SliderSpec[]=[
  {key:"pointerForce",label:"Pointer force",labelFa:"نیروی نشانگر",min:.35,max:1.80,step:.01},
  {key:"pointerRadius",label:"Pointer radius",labelFa:"شعاع نشانگر",min:.55,max:1.55,step:.01},
  {key:"waveStrength",label:"Shockwave strength",labelFa:"قدرت موج",min:.40,max:1.70,step:.01},
  {key:"waveRadius",label:"Shockwave reach",labelFa:"برد موج",min:.55,max:1.55,step:.01},
  {key:"vortexStrength",label:"Vortex strength",labelFa:"قدرت گرداب",min:.45,max:1.85,step:.01},
  {key:"vortexDuration",label:"Vortex duration",labelFa:"دوام گرداب",min:.45,max:1.75,step:.01},
]
const ACOUSTIC_SLIDERS:SliderSpec[]=[
  {key:"collisionAcoustics",label:"Physical activity sensitivity",labelFa:"حساسیت فعالیت فیزیکی",min:.25,max:2.20,step:.01},
  {key:"noiseFloor",label:"Passive air level",labelFa:"سطح هوای غیرفعال",min:0,max:2.00,step:.01},
  {key:"noiseActiveMin",label:"Active air minimum",labelFa:"حداقل هوای فعال",min:0,max:1.50,step:.01},
  {key:"noiseMax",label:"Active air maximum",labelFa:"حداکثر هوای فعال",min:0,max:3.20,step:.01},
  {key:"noiseMotionSensitivity",label:"Passive motion → air",labelFa:"حرکت غیرفعال ← هوا",min:0,max:2.50,step:.01},
  {key:"noiseChaosSensitivity",label:"Active chaos → air",labelFa:"آشفتگی فعال ← هوا",min:0,max:2.80,step:.01},
  {key:"noiseIdleCutoff",label:"Passive air high-cut",labelFa:"کات بالای هوای غیرفعال",min:180,max:2200,step:10,unit:" Hz"},
  {key:"noiseActiveCutoff",label:"Active air brightness",labelFa:"درخشندگی هوای فعال",min:900,max:9000,step:25,unit:" Hz"},
  {key:"noiseResponse",label:"Air dynamics curve",labelFa:"منحنی دینامیک هوا",min:.40,max:2.80,step:.01},
  {key:"noiseRelease",label:"Air settle / release",labelFa:"زمان فرونشست هوا",min:.03,max:.80,step:.01,unit:" s"},
]
const CHIME_SLIDERS:SliderSpec[]=[
  {key:"chimeVolume",label:"Master chime level",labelFa:"سطح کلی زنگ",min:0,max:2.00,step:.01},
  {key:"lowChimeBias",label:"Global low-register color",labelFa:"رنگ کلی رجیستر بم",min:.35,max:1.65,step:.01},
  {key:"chimeChordFocus",label:"Chord-tone focus",labelFa:"تمرکز روی نت‌های آکورد",min:0,max:1,step:.01},
  {key:"chimeMinDelay",label:"Minimum spacing between chimes",labelFa:"حداقل فاصله بین زنگ‌ها",min:0,max:.35,step:.005,unit:" s"},
]
const PASSIVE_CHIME_SLIDERS:SliderSpec[]=[
  {key:"passiveChimeRate",label:"Passive trigger rate / chance",labelFa:"نرخ / احتمال زنگ غیرفعال",min:0,max:6.00,step:.01},
  {key:"passiveChimeVolume",label:"Passive loudness",labelFa:"بلندی زنگ غیرفعال",min:0,max:3.60,step:.01},
  {key:"passiveChimeOctaveBias",label:"Passive octave bias · low ↔ high",labelFa:"گرایش اکتاو غیرفعال · بم ↔ زیر",min:-1,max:1,step:.01},
  {key:"passiveChimeResponse",label:"Passive motion response",labelFa:"واکنش غیرفعال به حرکت",min:.40,max:2.20,step:.01},
]
const ACTIVE_CHIME_SLIDERS:SliderSpec[]=[
  {key:"activeChimeMinRate",label:"Active minimum trigger rate",labelFa:"حداقل نرخ تریگر فعال",min:0,max:4.00,step:.01,unit:" /s"},
  {key:"activeChimeRate",label:"Active maximum trigger rate",labelFa:"حداکثر نرخ تریگر فعال",min:0,max:30.00,step:.05,unit:" /s"},
  {key:"activeChimeMinVolume",label:"Active minimum loudness",labelFa:"حداقل بلندی فعال",min:0,max:1.80,step:.01},
  {key:"activeChimeVolume",label:"Active maximum loudness",labelFa:"حداکثر بلندی فعال",min:0,max:1.80,step:.01},
  {key:"activeChimeOctaveBias",label:"Active octave bias · low ↔ high",labelFa:"گرایش اکتاو فعال · بم ↔ زیر",min:-1,max:1,step:.01},
  {key:"activeChimeResponse",label:"Active physics sensitivity",labelFa:"حساسیت فیزیکی لایه فعال",min:0,max:2.50,step:.01},
  {key:"activeActivityContrast",label:"Active detection contrast · soft ↔ punchy",labelFa:"کنتراست تشخیص فعال · نرم ↔ کوبنده",min:.25,max:4.00,step:.01},
]
const SWEEP_CHIME_SLIDERS:SliderSpec[]=[
  {key:"sweepChimeRate",label:"Sweep note density",labelFa:"تراکم نت جاروب",min:.25,max:6.00,step:.01},
  {key:"sweepChimeVolume",label:"Sweep loudness",labelFa:"بلندی جاروب",min:0,max:1.80,step:.01},
  {key:"sweepChimeOctaveBias",label:"Sweep octave bias · low ↔ high",labelFa:"گرایش اکتاو جاروب · بم ↔ زیر",min:-2,max:2,step:.01},
  {key:"sweepChimeSpan",label:"Sweep register span",labelFa:"گستره رجیستر جاروب",min:.75,max:4.50,step:.05,unit:" oct"},
  {key:"sweepContactSensitivity",label:"Sweep contact sensitivity",labelFa:"حساسیت تماس جاروب",min:.25,max:5.00,step:.01},
]
const HARMONY_SLIDERS:SliderSpec[]=[
  {key:"musicRate",label:"Progression speed",labelFa:"سرعت پیشروی",min:.40,max:3.00,step:.01},
  {key:"harmonyGlide",label:"Chord glide time",labelFa:"زمان گذار آکورد",min:.10,max:2.20,step:.01},
  {key:"chimeAdoptionPoint",label:"Chime chord handoff",labelFa:"نقطه تغییر آکورد زنگ",min:0,max:.95,step:.01},
  {key:"reverb",label:"Celestial reverb",labelFa:"ریورب آسمانی",min:.20,max:1.75,step:.01},
]
const MIX_SLIDERS:SliderSpec[]=[
  {key:"bassVolume",label:"Bass level",labelFa:"سطح باس",min:0,max:1.60,step:.01},
  {key:"padVolume",label:"Pad / chord level",labelFa:"سطح پد / آکورد",min:0,max:1.75,step:.01},
]

const PALETTE_SELECT:SelectSpec={key:"palette",label:"Particle palette",labelFa:"پالت ذرات",options:[
  {value:0,label:"Heritage astral",labelFa:"آسترال اصلی"},
  {value:1,label:"Aurora cyan-violet",labelFa:"شفق فیروزه‌ای-بنفش"},
  {value:2,label:"Ice / electric blue",labelFa:"یخی / آبی الکتریکی"},
  {value:3,label:"Ember / gold",labelFa:"اخگر / طلایی"},
  {value:4,label:"Moon violet",labelFa:"بنفش مهتابی"},
  {value:5,label:"Pearl monochrome",labelFa:"مرواریدی تک‌رنگ"},
]}
const PAD_OCTAVE_SELECT:SelectSpec={key:"padOctave",label:"Pad octave",labelFa:"اکتاو پد",options:[
  {value:0,label:"Original register",labelFa:"رجیستر اصلی"},{value:1,label:"+1 octave · default",labelFa:"۱+ اکتاو · پیش‌فرض"},{value:2,label:"+2 octaves",labelFa:"۲+ اکتاو"}
]}
const BASS_OCTAVE_SELECT:SelectSpec={key:"bassOctave",label:"Bass octave",labelFa:"اکتاو باس",options:[
  {value:-1,label:"-1 octave · sub",labelFa:"۱- اکتاو · ساب"},{value:0,label:"Root register · default",labelFa:"رجیستر ریشه · پیش‌فرض"},{value:1,label:"+1 octave",labelFa:"۱+ اکتاو"}
]}
const PAD_TIMBRE_SELECT:SelectSpec={key:"padTimbre",label:"Pad timbre",labelFa:"رنگ صوتی پد",options:[
  {value:0,label:"Celestial soft",labelFa:"آسمانی نرم"},{value:1,label:"Glass sine",labelFa:"سینوسی شیشه‌ای"},{value:2,label:"Warm triangle",labelFa:"مثلثی گرم"},{value:3,label:"Airy hybrid",labelFa:"هیبرید هوایی"}
]}
const BASS_WAVE_SELECT:SelectSpec={key:"bassWave",label:"Bass character",labelFa:"شخصیت باس",options:[
  {value:0,label:"Pure sine",labelFa:"سینوسی خالص"},{value:1,label:"Soft triangle",labelFa:"مثلثی نرم"},{value:2,label:"Rounded saw",labelFa:"اره‌ای گرد"}
]}
const REGISTER_SELECT:SelectSpec={key:"registerOpenness",label:"Chime register spacing",labelFa:"فاصله رجیستر زنگ",options:[
  {value:.72,label:"Strict / very open lows",labelFa:"سخت‌گیر / بم بسیار باز"},{value:1,label:"Musical lower-limit · default",labelFa:"حد پایین موسیقایی · پیش‌فرض"},{value:1.30,label:"More colorful lows",labelFa:"بم رنگین‌تر"}
],hint:"Controls how quickly 5ths, 3rds, 6ths and other scale tones become legal as register rises.",hintFa:"تعیین می‌کند با بالا رفتن رجیستر، پنجم، سوم، ششم و دیگر درجات چه‌قدر زود مجاز شوند."}
const PASSIVE_CHIME_ENABLE_SELECT:SelectSpec={key:"passiveChimeEnabled",label:"Passive layer",labelFa:"لایه غیرفعال",options:[{value:1,label:"Enabled",labelFa:"فعال"},{value:0,label:"Disabled",labelFa:"خاموش"}]}
const ACTIVE_CHIME_ENABLE_SELECT:SelectSpec={key:"activeChimeEnabled",label:"Active chaos layer",labelFa:"لایه آشفتگی فعال",options:[{value:1,label:"Enabled",labelFa:"فعال"},{value:0,label:"Disabled",labelFa:"خاموش"}]}
const SWEEP_CHIME_ENABLE_SELECT:SelectSpec={key:"sweepChimeEnabled",label:"Orchestral sweep layer",labelFa:"لایه جاروب ارکسترال",options:[{value:1,label:"Enabled",labelFa:"فعال"},{value:0,label:"Disabled",labelFa:"خاموش"}]}
const CHIME_MIN_SELECT:SelectSpec={key:"chimeMinOctave",label:"Lowest chime octave",labelFa:"پایین‌ترین اکتاو زنگ",options:[2,3,4,5].map(value=>({value,label:`Octave ${value}`,labelFa:`اکتاو ${value}`}))}
const CHIME_MAX_SELECT:SelectSpec={key:"chimeMaxOctave",label:"Highest chime octave",labelFa:"بالاترین اکتاو زنگ",options:[5,6,7,8].map(value=>({value,label:`Octave ${value}`,labelFa:`اکتاو ${value}`}))}

function sanitizeTuning(value:unknown):ParticleHorseTuning{
  const raw=value&&typeof value==="object"?value as Partial<Record<keyof ParticleHorseTuning,unknown>>:{}
  const out={...DEFAULT_TUNING}
  for(const key of Object.keys(DEFAULT_TUNING) as Array<keyof ParticleHorseTuning>){const v=raw[key];if(typeof v==="number"&&Number.isFinite(v))(out as Record<string,number>)[key]=v}
  // Migrate the previous two-layer audio controls without breaking saved tuning JSON.
  const legacy=raw as Record<string,unknown>
  if(typeof legacy.passiveChimeDensity==="number"&&typeof legacy.passiveChimeRate!=="number")out.passiveChimeRate=legacy.passiveChimeDensity
  if(typeof legacy.accentChimeDensity==="number"&&typeof legacy.activeChimeRate!=="number")out.activeChimeRate=legacy.accentChimeDensity
  if(typeof legacy.accentChimeVolume==="number"&&typeof legacy.activeChimeVolume!=="number")out.activeChimeVolume=legacy.accentChimeVolume
  // v2 used activeChimeRate as a multiplier (0..3). Convert old values to a useful max events/sec.
  if(typeof legacy.activeChimeRate==="number"&&typeof legacy.activeChimeMinRate!=="number"&&legacy.activeChimeRate<=3)out.activeChimeRate=legacy.activeChimeRate*5.5
  out.horseScale=clamp(out.horseScale,.35,2.35)
  out.horseOffsetX=clamp(out.horseOffsetX,-1.5,1.5)
  out.particleMedian=clamp(out.particleMedian,out.particleMin,out.particleMax)
  out.progression=Math.round(clamp(out.progression,0,MUSIC_PROGRESSION_OPTIONS.length-1))
  out.palette=Math.round(clamp(out.palette,0,5))
  out.padOctave=Math.round(clamp(out.padOctave,0,2))
  out.bassOctave=Math.round(clamp(out.bassOctave,-1,1))
  out.padTimbre=Math.round(clamp(out.padTimbre,0,3))
  out.bassWave=Math.round(clamp(out.bassWave,0,2))
  out.chimeMinOctave=Math.round(clamp(out.chimeMinOctave,2,5))
  out.chimeMaxOctave=Math.round(clamp(out.chimeMaxOctave,Math.max(5,out.chimeMinOctave+1),8))
  out.noiseFloor=clamp(out.noiseFloor,0,2)
  out.noiseActiveMin=clamp(out.noiseActiveMin,0,1.5)
  out.noiseMax=clamp(out.noiseMax,out.noiseActiveMin,3.2)
  out.noiseIdleCutoff=clamp(out.noiseIdleCutoff,180,2200)
  out.noiseActiveCutoff=clamp(out.noiseActiveCutoff,Math.max(900,out.noiseIdleCutoff+200),9000)
  out.noiseResponse=clamp(out.noiseResponse,.4,2.8)
  out.noiseRelease=clamp(out.noiseRelease,.03,.8)
  out.noiseMotionSensitivity=clamp(out.noiseMotionSensitivity,0,2.5)
  out.noiseChaosSensitivity=clamp(out.noiseChaosSensitivity,0,2.8)
  out.chimeVolume=clamp(out.chimeVolume,0,2)
  out.lowChimeBias=clamp(out.lowChimeBias,.35,1.65)
  out.chimeMinDelay=clamp(out.chimeMinDelay,0,.35)
  out.chimeChordFocus=clamp(out.chimeChordFocus,0,1)
  out.passiveChimeEnabled=Math.round(clamp(out.passiveChimeEnabled,0,1))
  out.passiveChimeRate=clamp(out.passiveChimeRate,0,6)
  out.passiveChimeVolume=clamp(out.passiveChimeVolume,0,3.6)
  out.passiveChimeOctaveBias=clamp(out.passiveChimeOctaveBias,-1,1)
  out.passiveChimeResponse=clamp(out.passiveChimeResponse,.4,2.2)
  out.activeChimeEnabled=Math.round(clamp(out.activeChimeEnabled,0,1))
  out.activeChimeMinRate=clamp(out.activeChimeMinRate,0,4)
  out.activeChimeRate=clamp(out.activeChimeRate,out.activeChimeMinRate,30)
  out.activeChimeMinVolume=clamp(out.activeChimeMinVolume,0,1.8)
  out.activeChimeVolume=clamp(out.activeChimeVolume,out.activeChimeMinVolume,1.8)
  out.activeChimeOctaveBias=clamp(out.activeChimeOctaveBias,-1,1)
  out.activeChimeResponse=clamp(out.activeChimeResponse,0,2.5)
  out.activeActivityContrast=clamp(out.activeActivityContrast,.25,4)
  out.sweepChimeEnabled=Math.round(clamp(out.sweepChimeEnabled,0,1))
  out.sweepChimeRate=clamp(out.sweepChimeRate,.25,6)
  out.sweepChimeVolume=clamp(out.sweepChimeVolume,0,1.8)
  out.sweepChimeOctaveBias=clamp(out.sweepChimeOctaveBias,-2,2)
  out.sweepChimeSpan=clamp(out.sweepChimeSpan,.75,4.5)
  out.sweepContactSensitivity=clamp(out.sweepContactSensitivity,.25,5)
  return out
}
function sameTuning(a:ParticleHorseTuning,b:ParticleHorseTuning){return (Object.keys(DEFAULT_TUNING) as Array<keyof ParticleHorseTuning>).every(key=>Math.abs(a[key]-b[key])<1e-9)}
function loadTuning(){try{const raw=localStorage.getItem(TUNING_STORAGE_KEY);return raw?sanitizeTuning(JSON.parse(raw)):{...DEFAULT_TUNING}}catch{return {...DEFAULT_TUNING}}}

const HORSE_MODEL_URLS=PARTICLE_HORSE_MODEL_URL?[PARTICLE_HORSE_MODEL_URL]:[]
const GLB_MAGIC=0x46546c67
const JSON_CHUNK=0x4e4f534a
const BIN_CHUNK=0x004e4942
const COMPONENTS:Record<string,number>={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16}
const TAU=Math.PI*2

function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value))}
function mix(a:number,b:number,t:number){return a+(b-a)*t}
function fract(value:number){return value-Math.floor(value)}
function smoothstep(edge0:number,edge1:number,x:number){const t=clamp((x-edge0)/Math.max(1e-6,edge1-edge0),0,1);return t*t*(3-2*t)}
function activityContrast(value:number,contrast:number){const x=clamp(value,0,1),c=clamp(contrast,.25,4);if(Math.abs(c-1)<1e-6)return x;return x<.5?.5*Math.pow(x*2,c):1-.5*Math.pow((1-x)*2,c)}
function componentSize(type:number){switch(type){case 5120:case 5121:return 1;case 5122:case 5123:return 2;case 5125:case 5126:return 4;default:throw new Error(`Unsupported glTF component type ${type}`)}}
function readComponent(view:DataView,offset:number,type:number){switch(type){case 5120:return view.getInt8(offset);case 5121:return view.getUint8(offset);case 5122:return view.getInt16(offset,true);case 5123:return view.getUint16(offset,true);case 5125:return view.getUint32(offset,true);case 5126:return view.getFloat32(offset,true);default:throw new Error(`Unsupported glTF component type ${type}`)}}
function normalizeComponent(value:number,type:number){switch(type){case 5120:return Math.max(value/127,-1);case 5121:return value/255;case 5122:return Math.max(value/32767,-1);case 5123:return value/65535;default:return value}}

function accessorFloats(doc:GlbJson,bin:ArrayBuffer,index:number){
  const accessor=doc.accessors[index]
  if(!accessor||accessor.bufferView==null)throw new Error(`Missing accessor ${index}`)
  const bufferView=doc.bufferViews[accessor.bufferView]
  if(!bufferView)throw new Error(`Missing buffer view ${accessor.bufferView}`)
  const components=COMPONENTS[accessor.type]
  if(!components)throw new Error(`Unsupported accessor type ${accessor.type}`)
  const bytes=componentSize(accessor.componentType)
  const stride=bufferView.byteStride??components*bytes
  const start=(bufferView.byteOffset??0)+(accessor.byteOffset??0)
  const view=new DataView(bin)
  const out=new Float32Array(accessor.count*components)
  let o=0
  for(let i=0;i<accessor.count;i++){
    const row=start+i*stride
    for(let c=0;c<components;c++){
      const value=readComponent(view,row+c*bytes,accessor.componentType)
      out[o++]=accessor.normalized?normalizeComponent(value,accessor.componentType):value
    }
  }
  return out
}

function accessorIndices(doc:GlbJson,bin:ArrayBuffer,index:number){
  const accessor=doc.accessors[index]
  if(!accessor||accessor.bufferView==null)throw new Error(`Missing index accessor ${index}`)
  const bufferView=doc.bufferViews[accessor.bufferView]
  if(!bufferView)throw new Error(`Missing index buffer view ${accessor.bufferView}`)
  const bytes=componentSize(accessor.componentType)
  const stride=bufferView.byteStride??bytes
  const start=(bufferView.byteOffset??0)+(accessor.byteOffset??0)
  const view=new DataView(bin)
  const out=new Uint32Array(accessor.count)
  for(let i=0;i<accessor.count;i++)out[i]=readComponent(view,start+i*stride,accessor.componentType)>>>0
  return out
}

function parseGlb(buffer:ArrayBuffer):{doc:GlbJson;bin:ArrayBuffer}{
  const view=new DataView(buffer)
  if(view.byteLength<20||view.getUint32(0,true)!==GLB_MAGIC)throw new Error("Horse model is not a valid GLB file")
  const declared=view.getUint32(8,true)
  if(declared>buffer.byteLength)throw new Error("Horse GLB is truncated")
  let cursor=12
  let jsonText=""
  let bin:ArrayBuffer|null=null
  while(cursor+8<=declared){
    const len=view.getUint32(cursor,true)
    const type=view.getUint32(cursor+4,true)
    const start=cursor+8
    const end=start+len
    if(end>declared)throw new Error("Invalid GLB chunk length")
    if(type===JSON_CHUNK)jsonText=new TextDecoder().decode(new Uint8Array(buffer,start,len)).replace(/\u0000/g,"").trim()
    else if(type===BIN_CHUNK)bin=buffer.slice(start,end)
    cursor=end
  }
  if(!jsonText||!bin)throw new Error("Horse GLB is missing JSON or binary data")
  return {doc:JSON.parse(jsonText) as GlbJson,bin}
}

function extractHorseModel(buffer:ArrayBuffer):HorseModel{
  const {doc,bin}=parseGlb(buffer)
  const mesh=doc.meshes?.[0]
  const primitive=mesh?.primitives?.[0]
  if(!primitive)throw new Error("Horse GLB contains no mesh primitive")
  if((primitive.mode??4)!==4)throw new Error("Horse mesh must use triangle primitives")
  const positionAccessor=primitive.attributes?.POSITION
  if(positionAccessor==null)throw new Error("Horse mesh has no POSITION attribute")
  const base=accessorFloats(doc,bin,positionAccessor)
  if(base.length%3)throw new Error("Horse POSITION accessor is malformed")
  const vertexCount=base.length/3
  const morphs=(primitive.targets??[]).map(target=>{
    const position=target.POSITION
    if(position==null)return new Float32Array(base.length)
    const values=accessorFloats(doc,bin,position)
    if(values.length!==base.length)throw new Error("Horse morph target vertex count mismatch")
    return values
  })
  const indices=primitive.indices==null?Uint32Array.from({length:vertexCount},(_,i)=>i):accessorIndices(doc,bin,primitive.indices)
  const node=doc.nodes?.find(item=>item.mesh===0)
  const defaults=node?.weights??mesh?.weights??[]
  const weightsDefault=new Float32Array(morphs.length)
  for(let i=0;i<weightsDefault.length;i++)weightsDefault[i]=Number(defaults[i]??0)
  let animation:MorphAnimation|null=null
  for(const candidate of doc.animations??[]){
    const channel=candidate.channels.find(item=>item.target.path==="weights")
    if(!channel)continue
    const sampler=candidate.samplers[channel.sampler]
    if(!sampler)continue
    const times=accessorFloats(doc,bin,sampler.input)
    const values=accessorFloats(doc,bin,sampler.output)
    if(!times.length||!values.length||!morphs.length)continue
    animation={times,values,interpolation:sampler.interpolation??"LINEAR",morphCount:morphs.length,duration:times[times.length-1]??1}
    break
  }
  return {base,morphs,indices,weightsDefault,animation,vertexCount}
}

async function fetchHorseModel(signal:AbortSignal){
  const failures:string[]=[]
  for(const url of HORSE_MODEL_URLS){
    try{
      const response=await fetch(url,{signal,mode:"cors",cache:"force-cache",credentials:"omit",referrerPolicy:"no-referrer"})
      if(!response.ok)throw new Error(`HTTP ${response.status}`)
      const buffer=await response.arrayBuffer()
      const model=extractHorseModel(buffer)
      if(import.meta.env.DEV)console.info("[ParticleHorse] model loaded",url)
      return model
    }catch(error){
      if(signal.aborted)throw error
      const message=error instanceof Error?error.message:String(error)
      failures.push(`${url}: ${message}`)
      console.warn("[ParticleHorse] model source failed",url,error)
    }
  }
  throw new Error(`Unable to load the animated horse model. ${failures.join(" | ")}`)
}

function xorshift(seed:number){
  let state=seed>>>0||0x9e3779b9
  return ()=>{
    state^=state<<13
    state^=state>>>17
    state^=state<<5
    return (state>>>0)/4294967296
  }
}

function buildTransforms(model:HorseModel){
  const {base,morphs}=model
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity
  const inspect=(x:number,y:number,z:number)=>{if(x<minX)minX=x;if(y<minY)minY=y;if(z<minZ)minZ=z;if(x>maxX)maxX=x;if(y>maxY)maxY=y;if(z>maxZ)maxZ=z}
  for(let i=0;i<base.length;i+=3){
    const bx=base[i],by=base[i+1],bz=base[i+2]
    inspect(bx,by,bz)
    for(const morph of morphs)inspect(bx+morph[i],by+morph[i+1],bz+morph[i+2])
  }
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,cz=(minZ+maxZ)/2
  const span=Math.max(maxX-minX,maxY-minY,maxZ-minZ,1)
  const scale=3.62/span
  const transformedBase=new Float32Array(base.length)
  for(let i=0;i<base.length;i+=3){
    transformedBase[i]=(base[i+2]-cz)*scale-0.34
    transformedBase[i+1]=(base[i+1]-cy)*scale+0.05
    transformedBase[i+2]=(base[i]-cx)*scale-0.13
  }
  const transformedMorphs=morphs.map(morph=>{
    const out=new Float32Array(morph.length)
    for(let i=0;i<morph.length;i+=3){
      out[i]=morph[i+2]*scale
      out[i+1]=morph[i+1]*scale
      out[i+2]=morph[i]*scale
    }
    return out
  })
  return {base:transformedBase,morphs:transformedMorphs}
}

function buildSurface(base:Float32Array,indices:Uint32Array,count:number,groupCount:number):ParticleSurface{
  const triangleCount=Math.floor(indices.length/3)
  if(!triangleCount)throw new Error("Horse mesh has no triangles")
  const cumulative=new Float64Array(triangleCount)
  let total=0
  for(let t=0;t<triangleCount;t++){
    const ia=indices[t*3]*3,ib=indices[t*3+1]*3,ic=indices[t*3+2]*3
    const abx=base[ib]-base[ia],aby=base[ib+1]-base[ia+1],abz=base[ib+2]-base[ia+2]
    const acx=base[ic]-base[ia],acy=base[ic+1]-base[ia+1],acz=base[ic+2]-base[ia+2]
    const cx=aby*acz-abz*acy,cy=abz*acx-abx*acz,cz=abx*acy-aby*acx
    total+=Math.max(1e-8,.5*Math.hypot(cx,cy,cz))
    cumulative[t]=total
  }
  const triA=new Uint32Array(count),triB=new Uint32Array(count),triC=new Uint32Array(count),ba=new Float32Array(count),bb=new Float32Array(count),bc=new Float32Array(count)
  const triA2=new Uint32Array(count),triB2=new Uint32Array(count),triC2=new Uint32Array(count),ba2=new Float32Array(count),bb2=new Float32Array(count),bc2=new Float32Array(count)
  const seed=new Float32Array(count),scale=new Float32Array(count),orbitBase=new Float32Array(count*3),link=new Uint32Array(count),group=new Uint16Array(count)
  const random=xorshift(0x48525345)
  const findTriangle=(value:number)=>{let lo=0,hi=triangleCount-1;while(lo<hi){const mid=(lo+hi)>>>1;if(cumulative[mid]<value)lo=mid+1;else hi=mid}return lo}
  const sampleOne=(index:number,alt=false)=>{
    const tri=findTriangle(random()*total)
    const r1=Math.sqrt(random())
    const r2=random()
    const a=indices[tri*3],b=indices[tri*3+1],c=indices[tri*3+2]
    const wa=1-r1,wb=r1*(1-r2),wc=r1*r2
    if(alt){triA2[index]=a;triB2[index]=b;triC2[index]=c;ba2[index]=wa;bb2[index]=wb;bc2[index]=wc}
    else{triA[index]=a;triB[index]=b;triC[index]=c;ba[index]=wa;bb[index]=wb;bc[index]=wc}
  }
  for(let i=0;i<count;i++){
    sampleOne(i,false)
    sampleOne(i,true)
    seed[i]=random()
    scale[i]=0.48+Math.pow(random(),1.08)*.84
    const z=random()*2-1
    const a=random()*TAU
    const radius=1.58+random()*.58
    const s=Math.sqrt(Math.max(0,1-z*z))
    const o=i*3
    orbitBase[o]=Math.cos(a)*s*radius
    orbitBase[o+1]=z*(.88+random()*.38)
    orbitBase[o+2]=Math.sin(a)*s*radius
    link[i]=Math.floor(random()*count)
    group[i]=Math.floor(random()*groupCount)
  }
  return {triA,triB,triC,ba,bb,bc,triA2,triB2,triC2,ba2,bb2,bc2,seed,scale,orbitBase,link,group,count,groupCount}
}

function sampleWeights(animation:MorphAnimation|null,defaults:Float32Array,time:number,out:Float32Array){
  out.set(defaults)
  if(!animation||animation.duration<=0||animation.times.length===0)return
  const {times,values,morphCount,interpolation}=animation
  const local=((time%animation.duration)+animation.duration)%animation.duration
  let hi=1
  while(hi<times.length&&times[hi]<local)hi++
  if(hi>=times.length)hi=times.length-1
  const lo=Math.max(0,hi-1)
  const t0=times[lo]??0,t1=times[hi]??t0
  const blend=t1>t0?(local-t0)/(t1-t0):0
  const cubic=interpolation==="CUBICSPLINE"
  const stride=morphCount*(cubic?3:1)
  const sampleOffset=(frame:number)=>frame*stride+(cubic?morphCount:0)
  const o0=sampleOffset(lo),o1=sampleOffset(hi)
  for(let i=0;i<morphCount;i++){
    const a=values[o0+i]??0,b=values[o1+i]??a
    out[i]=interpolation==="STEP"?a:a+(b-a)*blend
  }
}

function morphVertices(base:Float32Array,morphs:Float32Array[],weights:Float32Array,out:Float32Array){
  out.set(base)
  for(let m=0;m<morphs.length;m++){
    const w=weights[m]??0
    if(Math.abs(w)<.0005)continue
    const source=morphs[m]
    for(let i=0;i<out.length;i++)out[i]+=source[i]*w
  }
}

function compileShader(gl:WebGLRenderingContext,type:number,source:string){
  const shader=gl.createShader(type)
  if(!shader)throw new Error("WebGL shader allocation failed")
  gl.shaderSource(shader,source)
  gl.compileShader(shader)
  if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){
    const error=gl.getShaderInfoLog(shader)||"Shader compilation failed"
    gl.deleteShader(shader)
    throw new Error(error)
  }
  return shader
}

function buildProgram(gl:WebGLRenderingContext){
  const vertex=compileShader(gl,gl.VERTEX_SHADER,`precision highp float;
attribute vec3 aPosition;attribute float aSeed;attribute float aScale;
uniform float uYaw;uniform float uPitch;uniform float uAspect;uniform float uPointScale;uniform float uDepthBias;uniform float uSceneScale;
uniform vec2 uStageScale;uniform vec2 uStageOffset;
uniform float uSizeMin;uniform float uSizeMedian;uniform float uSizeMax;uniform float uSmallBrightness;uniform float uLargeBrightness;uniform float uBrightnessRandomness;uniform float uWinkDepth;uniform float uWinkSizeBias;uniform mediump float uWinkSpeed;uniform mediump float uWinkSpeedRandomness;uniform mediump float uTime;
varying float vSeed;varying float vDepth;varying float vLight;varying float vDust;varying float vSizeLight;varying float vWink;varying float vWinkMix;
void main(){
  float cy=cos(uYaw),sy=sin(uYaw),cp=cos(uPitch),sp=sin(uPitch);
  vec3 p=vec3(cy*aPosition.x+sy*aPosition.z,aPosition.y,-sy*aPosition.x+cy*aPosition.z);
  p=vec3(p.x,cp*p.y-sp*p.z,sp*p.y+cp*p.z)*uSceneScale;
  float depth=4.35-p.z;float f=1.82;
  float sx=p.x*f/(max(.1,uAspect)*depth);float syy=p.y*f/depth;
  float z=clamp((depth-2.10)/4.0,0.0,1.0)*2.0-1.0+uDepthBias;
  gl_Position=vec4(uStageOffset.x+sx*uStageScale.x,uStageOffset.y+syy*uStageScale.y,z,1.0);
  float perspective=clamp(4.35/depth,.64,1.64);
  vec3 normal=normalize(p+vec3(-.20,.08,.10));vec3 key=normalize(vec3(.82,.48,1.24));vec3 fill=normalize(vec3(-.55,.15,.80));
  float lit=max(0.0,dot(normal,key));float soft=max(0.0,dot(normal,fill));float rim=pow(clamp(1.0-abs(dot(normal,normalize(vec3(0.0,0.0,1.0)))),0.0,1.0),1.35);
  vLight=clamp(lit*.72+soft*.22+rim*.86,0.0,1.55);
  float sizeT=clamp((aScale-.48)/.84,0.0,1.0);
  float mappedSize=sizeT<.5?mix(uSizeMin,uSizeMedian,sizeT*2.0):mix(uSizeMedian,uSizeMax,(sizeT-.5)*2.0);
  float sizeShape=uDepthBias>.0001?aScale:mappedSize;
  float winkSpeedJitter=max(.02,1.0+(fract(aSeed*29.73)-.5)*2.0*uWinkSpeedRandomness);
  float localWinkSpeed=uWinkSpeed*winkSpeedJitter;
  float shimmer=.5+.5*sin(uTime*localWinkSpeed*(1.08+fract(aSeed*4.1)*4.6)+aSeed*87.3);
  float micro=.5+.5*sin(uTime*localWinkSpeed*(4.1+fract(aSeed*9.2)*5.4)+aSeed*151.0);
  float wink=pow(clamp(shimmer*.82+micro*.18,0.0,1.0),6.0);
  float randomLight=1.0+(fract(aSeed*37.11)-.5)*2.0*uBrightnessRandomness;
  vSizeLight=clamp(mix(uSmallBrightness,uLargeBrightness,sizeT)*randomLight,.10,12.0);
  float biasAmount=smoothstep(0.0,1.0,abs(uWinkSizeBias));
  float smallOnly=1.0-smoothstep(.16,.68,sizeT);
  float largeOnly=smoothstep(.32,.84,sizeT);
  float biasedParticipation=uWinkSizeBias<0.0?smallOnly:largeOnly;
  vWinkMix=mix(1.0,biasedParticipation,biasAmount);
  float winkSignal=clamp(shimmer*.72+wink*.28,0.0,1.0);
  float winkFloor=max(.004,1.0-min(uWinkDepth,1.0));
  float winkOverdrive=max(0.0,uWinkDepth-1.0);
  float winkShape=1.0+winkOverdrive*3.6;
  float rawWink=mix(winkFloor,1.0,pow(winkSignal,winkShape));
  vWink=mix(1.0,rawWink,vWinkMix);
  float visualShimmer=mix(.5,shimmer,vWinkMix);
  float visualWink=wink*vWinkMix;
  gl_PointSize=uPointScale*sizeShape*(.72+fract(aSeed*17.13)*.22+visualShimmer*.10+visualWink*.20)*perspective;
  vSeed=aSeed;vDepth=perspective;vDust=uDepthBias;
}`)
  const fragment=compileShader(gl,gl.FRAGMENT_SHADER,`precision mediump float;
uniform float uDark;uniform float uOpacity;uniform float uOverallBrightness;uniform float uSaturation;uniform float uPalette;uniform float uRenderMode;uniform float uFineBloomThreshold;uniform mediump float uTime;uniform mediump float uWinkSpeed;uniform mediump float uWinkSpeedRandomness;
varying float vSeed;varying float vDepth;varying float vLight;varying float vDust;varying float vSizeLight;varying float vWink;varying float vWinkMix;
void main(){
  vec2 q=gl_PointCoord-.5;float r=length(q)*2.0;if(r>1.0)discard;
  float disc=smoothstep(1.0,.06,r);float core=smoothstep(.8,.01,r);float glow=exp(-4.45*r*r);
  float winkSpeedJitter=max(.02,1.0+(fract(vSeed*29.73)-.5)*2.0*uWinkSpeedRandomness);
  float localWinkSpeed=uWinkSpeed*winkSpeedJitter;
  float twinkle=.5+.5*sin(uTime*localWinkSpeed*(1.35+fract(vSeed*5.3)*5.8)+vSeed*91.7);
  float flicker=.5+.5*sin(uTime*localWinkSpeed*(4.7+fract(vSeed*8.9)*6.2)+vSeed*173.1);
  twinkle=mix(.62,twinkle,vWinkMix);
  flicker=mix(.62,flicker,vWinkMix);
  float wink=pow(clamp(twinkle*.80+flicker*.20,0.0,1.0),7.0);
  float sparkleMask=smoothstep(.23,0.0,abs(fract(vSeed*13.71)-.5));float sparkle=(.10+.90*sparkleMask)*(.12+twinkle*.30+wink*.86);float bloom=smoothstep(1.0,.10,1.0-r)*(.08+wink*.92);
  float seedPalette=fract(vSeed*7.17);
  vec3 cold=vec3(.58,.88,1.0);vec3 warm=vec3(1.0,.76,.46);vec3 teal=vec3(.32,.88,.74);vec3 violet=vec3(.72,.62,1.0);
  vec3 astral=mix(mix(cold,teal,smoothstep(.05,.45,seedPalette)),mix(violet,warm,smoothstep(.55,.95,seedPalette)),smoothstep(.42,.68,seedPalette));
  vec3 aurora=mix(mix(vec3(.20,1.0,.84),vec3(.42,.72,1.0),smoothstep(.05,.50,seedPalette)),vec3(.92,.46,1.0),smoothstep(.48,.96,seedPalette));
  vec3 ice=mix(vec3(.44,.82,1.0),vec3(.78,.96,1.0),smoothstep(.12,.88,seedPalette));
  vec3 ember=mix(vec3(1.0,.42,.12),vec3(1.0,.92,.48),smoothstep(.10,.90,seedPalette));
  vec3 moon=mix(vec3(.52,.45,1.0),vec3(.90,.80,1.0),smoothstep(.08,.90,seedPalette));
  vec3 pearl=mix(vec3(.72,.78,.86),vec3(1.0,.98,.94),smoothstep(.12,.86,seedPalette));
  vec3 paletteColor=astral;
  if(uPalette>.5&&uPalette<1.5)paletteColor=aurora;else if(uPalette>=1.5&&uPalette<2.5)paletteColor=ice;else if(uPalette>=2.5&&uPalette<3.5)paletteColor=ember;else if(uPalette>=3.5&&uPalette<4.5)paletteColor=moon;else if(uPalette>=4.5)paletteColor=pearl;
  vec3 ink=vec3(.04,.05,.065);
  vec3 darkColor=mix(paletteColor,vec3(1.0),clamp(vLight*.10+sparkle*.68+bloom*.34,0.0,.44));vec3 lightColor=mix(ink,paletteColor,clamp(.28+vLight*.32+sparkle*1.04+bloom*.56,0.0,.92));
  vec3 color=mix(lightColor,darkColor,uDark);color=mix(color,paletteColor,clamp(.08+sparkle*.16+bloom*.14,0.0,.30));
  float sizeSpark=clamp((vSizeLight-1.0)*.55,0.0,.48);color=mix(color,vec3(1.0),clamp(wink*.58+bloom*.20+sizeSpark,0.0,.76));
  float luma=dot(color,vec3(.2126,.7152,.0722));color=mix(vec3(luma),color,uSaturation)*uOverallBrightness;
  float airy=mix(1.0,.58,clamp(vDust*800.0,0.0,1.0));
  float emissive=luma*uOverallBrightness*mix(.72,1.18,clamp(vLight/1.55,0.0,1.0))*vSizeLight*vWink*(.72+twinkle*.20+wink*.72);
  if(uRenderMode>1.5){
    float trail=exp(-3.15*r*r)*disc;
    float trailAlpha=trail*uOpacity*mix(.76,1.08,vDepth)*(.58+vWink*.42)*clamp(.58+vSizeLight*.28,.52,1.22);
    vec3 trailColor=mix(paletteColor,color,.52+uDark*.22);
    gl_FragColor=vec4(trailColor,trailAlpha);
    return;
  }
  if(uRenderMode>.5){
    // Soft-knee bright pass: bloom starts gently below the nominal threshold,
    // crosses it continuously, and then grows non-linearly with emissive energy.
    float threshold=max(.001,uFineBloomThreshold);
    float knee=max(.07,threshold*.62);
    float softX=clamp((emissive-(threshold-knee))/(2.0*knee),0.0,1.0);
    float softGate=softX*softX*(3.0-2.0*softX);
    float hardExcess=max(0.0,emissive-threshold);
    float hardGate=1.0-exp(-hardExcess*1.35);
    float bloomGate=clamp(softGate*softGate*.48+hardGate*.92,0.0,1.0);
    if(bloomGate<.004)discard;
    float tightCore=exp(-13.0*r*r);
    float softCore=exp(-4.8*r*r);
    float brightCore=(tightCore*.52+softCore*.72)*disc;
    float sourceLift=.92+min(2.8,emissive)*.38+hardGate*.42;
    float brightEnergy=clamp(brightCore*bloomGate*sourceLift*uOpacity*mix(.88,1.14,vDepth)*airy,0.0,1.0);
    vec3 fineColor=mix(paletteColor,vec3(1.0),clamp(.10+bloomGate*.28+hardGate*.24+wink*.08,0.0,.66));
    gl_FragColor=vec4(fineColor*brightEnergy,brightEnergy);
    return;
  }
  float alpha=(core*.84+glow*.30+sparkle*.22+bloom*.38)*uOpacity*mix(.78,1.12,vLight)*mix(.84,1.0,vDepth)*airy*(.72+twinkle*.20+wink*.72)*vWink*vSizeLight;
  if(uDark>.5)alpha*=mix(.96,1.48,glow*.55+wink*.72);
  gl_FragColor=vec4(color,alpha*disc);
}`)
  const program=gl.createProgram()
  if(!program)throw new Error("WebGL program allocation failed")
  gl.attachShader(program,vertex)
  gl.attachShader(program,fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
    const error=gl.getProgramInfoLog(program)||"WebGL program link failed"
    gl.deleteProgram(program)
    throw new Error(error)
  }
  return program
}

function buildBloomPostProgram(gl:WebGLRenderingContext){
  const vertex=compileShader(gl,gl.VERTEX_SHADER,`precision mediump float;
attribute vec2 aPosition;varying vec2 vUv;
void main(){vUv=aPosition*.5+.5;gl_Position=vec4(aPosition,0.0,1.0);}`)
  const fragment=compileShader(gl,gl.FRAGMENT_SHADER,`precision mediump float;
uniform sampler2D uTexture;uniform vec2 uDirection;uniform float uComposite;uniform float uIntensity;varying vec2 vUv;
void main(){
  if(uComposite>.5){
    vec4 sampleColor=texture2D(uTexture,vUv);
    gl_FragColor=vec4(sampleColor.rgb*uIntensity,sampleColor.a*uIntensity);
    return;
  }
  vec4 color=texture2D(uTexture,vUv)*.227027;
  color+=texture2D(uTexture,vUv+uDirection*1.384615)*.316216;
  color+=texture2D(uTexture,vUv-uDirection*1.384615)*.316216;
  color+=texture2D(uTexture,vUv+uDirection*3.230769)*.070270;
  color+=texture2D(uTexture,vUv-uDirection*3.230769)*.070270;
  gl_FragColor=color;
}`)
  const program=gl.createProgram()
  if(!program)throw new Error("WebGL bloom program allocation failed")
  gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program)
  gl.deleteShader(vertex);gl.deleteShader(fragment)
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){
    const error=gl.getProgramInfoLog(program)||"Bloom shader linking failed"
    gl.deleteProgram(program)
    throw new Error(error)
  }
  return program
}

function inverseRotate(point:Vec3,yaw:number,pitch:number):Vec3{
  const cp=Math.cos(-pitch),sp=Math.sin(-pitch)
  const y=cp*point.y-sp*point.z,z=sp*point.y+cp*point.z
  const cy=Math.cos(-yaw),sy=Math.sin(-yaw)
  return {x:cy*point.x+sy*z,y,z:-sy*point.x+cy*z}
}

function createNoiseBuffer(context:AudioContext,duration:number){
  const sampleRate=context.sampleRate
  const frameCount=Math.max(1,Math.floor(sampleRate*duration))
  const buffer=context.createBuffer(1,frameCount,sampleRate)
  const data=buffer.getChannelData(0)
  let brown=0
  for(let i=0;i<frameCount;i++){
    brown=(brown+(Math.random()*2-1)*.14)*.985
    data[i]=brown*0.65+(Math.random()*2-1)*0.18
  }
  return buffer
}

function createParticleHorseAudioEngine():AudioEngine{
  const AudioCtor=globalThis.AudioContext||(globalThis as typeof globalThis&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext
  if(!AudioCtor)return {arm:()=>{},step:()=>{},trigger:()=>{},idle:()=>{},configure:()=>{},dispose:()=>{}}

  type HarmonyStep={pad:number[];hold:number;brightness:number;rootPc:number;scale:number[]}
  type Progression={id:string;label:string;labelFa:string;steps:HarmonyStep[]}
  const MAJOR=[0,2,4,5,7,9,11],MINOR=[0,2,3,5,7,8,10],DORIAN=[0,2,3,5,7,9,10],LYDIAN=[0,2,4,6,7,9,11],MIXOLYDIAN=[0,2,4,5,7,9,10]
  const PROGRESSIONS:Progression[]=[
    {id:"celestial",label:"Celestial",labelFa:"آسمانی",steps:[
      {pad:[38,45,50,53,57],hold:13.5,brightness:.40,rootPc:2,scale:DORIAN},
      {pad:[34,41,45,50,53],hold:12.0,brightness:.48,rootPc:10,scale:MAJOR},
      {pad:[41,48,52,55,57],hold:14.0,brightness:.57,rootPc:5,scale:MAJOR},
      {pad:[36,43,50,52,55],hold:11.5,brightness:.52,rootPc:0,scale:MAJOR},
      {pad:[43,50,53,57,60],hold:13.0,brightness:.46,rootPc:7,scale:DORIAN},
      {pad:[45,50,53,57,64],hold:12.5,brightness:.60,rootPc:2,scale:DORIAN},
      {pad:[34,41,48,50,57],hold:14.5,brightness:.44,rootPc:10,scale:MAJOR},
      {pad:[36,43,48,52,57],hold:11.0,brightness:.62,rootPc:0,scale:MAJOR},
      {pad:[38,45,52,53,57],hold:15.0,brightness:.52,rootPc:2,scale:DORIAN},
      {pad:[41,48,53,57,60],hold:12.0,brightness:.66,rootPc:5,scale:MAJOR},
      {pad:[43,50,57,60,64],hold:13.5,brightness:.58,rootPc:7,scale:DORIAN},
      {pad:[45,52,57,62,65],hold:15.5,brightness:.70,rootPc:2,scale:DORIAN},
    ]},
    {id:"neoclassical",label:"Neo-classical",labelFa:"نئوکلاسیک",steps:[
      {pad:[33,40,45,48,52],hold:11.8,brightness:.40,rootPc:9,scale:MINOR},
      {pad:[29,36,41,45,48],hold:12.8,brightness:.52,rootPc:5,scale:MAJOR},
      {pad:[36,43,48,52,55],hold:10.6,brightness:.60,rootPc:0,scale:MAJOR},
      {pad:[31,38,43,47,50],hold:11.4,brightness:.50,rootPc:7,scale:MAJOR},
      {pad:[28,35,40,44,47],hold:12.2,brightness:.66,rootPc:4,scale:MIXOLYDIAN},
      {pad:[33,40,45,52,57],hold:14.2,brightness:.48,rootPc:9,scale:MINOR},
    ]},
    {id:"lydian",label:"Lydian dream",labelFa:"رویای لیدین",steps:[
      {pad:[36,43,48,54,59],hold:14.0,brightness:.72,rootPc:0,scale:LYDIAN},
      {pad:[38,45,50,56,61],hold:12.5,brightness:.78,rootPc:2,scale:LYDIAN},
      {pad:[40,47,52,55,59],hold:13.2,brightness:.70,rootPc:4,scale:MINOR},
      {pad:[36,43,50,54,57],hold:14.8,brightness:.80,rootPc:0,scale:LYDIAN},
      {pad:[43,50,55,59,62],hold:12.8,brightness:.68,rootPc:7,scale:MAJOR},
      {pad:[38,45,52,56,61],hold:15.0,brightness:.82,rootPc:2,scale:LYDIAN},
    ]},
    {id:"jazz",label:"Nocturne jazz",labelFa:"جاز شبانه",steps:[
      {pad:[38,45,48,52,57],hold:10.8,brightness:.46,rootPc:2,scale:DORIAN},
      {pad:[43,50,53,57,64],hold:10.2,brightness:.56,rootPc:7,scale:MIXOLYDIAN},
      {pad:[36,43,47,52,57],hold:12.0,brightness:.64,rootPc:0,scale:MAJOR},
      {pad:[33,40,43,49,52],hold:9.8,brightness:.60,rootPc:9,scale:MIXOLYDIAN},
      {pad:[38,45,48,53,57],hold:12.8,brightness:.50,rootPc:2,scale:DORIAN},
      {pad:[34,41,45,50,53],hold:11.2,brightness:.56,rootPc:10,scale:MAJOR},
    ]},
    {id:"minimal",label:"Minimal glass",labelFa:"مینیمال شیشه‌ای",steps:[
      {pad:[38,45,50,57,62],hold:16.0,brightness:.38,rootPc:2,scale:DORIAN},
      {pad:[41,48,53,57,60],hold:15.0,brightness:.50,rootPc:5,scale:MAJOR},
      {pad:[36,43,50,55,60],hold:17.0,brightness:.44,rootPc:0,scale:MAJOR},
      {pad:[43,50,55,60,62],hold:16.5,brightness:.48,rootPc:7,scale:DORIAN},
    ]},
    {id:"dorian",label:"Dorian meditation",labelFa:"مدیتیشن دورین",steps:[
      {pad:[38,45,50,53,57],hold:14.5,brightness:.42,rootPc:2,scale:DORIAN},
      {pad:[43,50,55,59,62],hold:13.0,brightness:.55,rootPc:7,scale:MIXOLYDIAN},
      {pad:[36,43,48,52,57],hold:13.5,brightness:.62,rootPc:0,scale:MAJOR},
      {pad:[38,45,52,57,59],hold:15.0,brightness:.48,rootPc:2,scale:DORIAN},
      {pad:[34,41,46,50,53],hold:14.0,brightness:.50,rootPc:10,scale:MAJOR},
      {pad:[38,45,50,57,64],hold:16.0,brightness:.58,rootPc:2,scale:DORIAN},
    ]},
  ]
  const midiHz=(midi:number)=>440*Math.pow(2,(midi-69)/12)

  let ctx:AudioContext|null=null
  let master:GainNode|null=null
  let compressor:DynamicsCompressorNode|null=null
  let reverbInput:GainNode|null=null
  let reverb:ConvolverNode|null=null
  let reverbOutput:GainNode|null=null
  let humFilter:BiquadFilterNode|null=null
  let humGain:GainNode|null=null
  let bassFilter:BiquadFilterNode|null=null
  let bassGain:GainNode|null=null
  let bassVoice:OscillatorNode|null=null
  let motionHighpass:BiquadFilterNode|null=null
  let motionFilter:BiquadFilterNode|null=null
  let motionGain:GainNode|null=null
  let motionSource:AudioBufferSourceNode|null=null
  let padVoices:OscillatorNode[]=[]
  let lfo:OscillatorNode|null=null
  let lfoGain:GainNode|null=null
  let noiseBuffer:AudioBuffer|null=null
  let harmonyIndex=0
  let harmonyCycle=0
  let nextHarmonyAt=0
  let ambientCounter=0
  let lastChime=0
  let scheduledBellAttacks:number[]=[]
  let scheduledSweepAttacks:number[]=[]
  let lastAudioStepAt=0
  let lastPassiveChimeAt=0
  let lastActiveChimeAt=0
  let lastSweepLane:number|null=null
  let lastSweepContactAt=0
  let gestureSweepCounter=0
  let gestureExcitation=0
  let activeGestureEnvelope=0
  let turbulenceEnvelope=0
  let physicalNoiseEnvelope=0
  let previousPhysicalDrive=0
  let physicalChimeCounter=0
  let lastPhysicalMidi:number|null=null
  let previousCollisionSignature=.5
  let backgroundTimer:number|null=null
  let tuning={...DEFAULT_TUNING}
  let activeProgression=0
  let previousHarmony:HarmonyStep|null=null
  let harmonyTransitionStart=0
  let harmonyTransitionDuration=4.8

  const createReverbImpulse=(context:AudioContext,duration=5.2,decay=2.7)=>{
    const length=Math.max(1,Math.floor(context.sampleRate*duration))
    const buffer=context.createBuffer(2,length,context.sampleRate)
    for(let channel=0;channel<2;channel++){
      const data=buffer.getChannelData(channel)
      let smooth=0
      for(let i=0;i<length;i++){
        const t=i/length
        const envelope=Math.pow(1-t,decay)
        const noise=Math.random()*2-1
        smooth=smooth*.72+noise*.28
        const early=i<context.sampleRate*.16?(1-t*3.6):.72
        data[i]=(noise*.42+smooth*.58)*envelope*early*(channel? .92:1)
      }
    }
    return buffer
  }

  const currentProgression=()=>PROGRESSIONS[Math.round(clamp(tuning.progression,0,PROGRESSIONS.length-1))]??PROGRESSIONS[0]
  const currentHarmony=()=>{const steps=currentProgression().steps;return steps[harmonyIndex%steps.length]}
  const bellHarmony=(now:number)=>{
    if(!previousHarmony||harmonyTransitionDuration<=0)return currentHarmony()
    const progress=clamp((now-harmonyTransitionStart)/harmonyTransitionDuration,0,1)
    return progress>=clamp(tuning.chimeAdoptionPoint,0,.95)?currentHarmony():previousHarmony
  }

  const padTypes=():OscillatorType[]=>{
    const mode=Math.round(tuning.padTimbre)
    if(mode===1)return ["sine","sine","sine","sine","sine"]
    if(mode===2)return ["triangle","triangle","triangle","triangle","triangle"]
    if(mode===3)return ["sine","triangle","sine","sawtooth","triangle"]
    return ["sine","triangle","sine","sine","triangle"]
  }
  const bassType=():OscillatorType=>Math.round(tuning.bassWave)===1?"triangle":Math.round(tuning.bassWave)===2?"sawtooth":"sine"
  const bassMidiFor=(harmony:HarmonyStep)=>36+harmony.rootPc+Math.round(tuning.bassOctave)*12

  const applyHarmony=(now:number,advance:boolean)=>{
    if(!ctx||!humFilter)return
    const steps=currentProgression().steps
    if(advance){
      previousHarmony=currentHarmony()
      harmonyIndex=(harmonyIndex+1)%steps.length
      if(harmonyIndex===0)harmonyCycle++
      harmonyTransitionStart=now
      harmonyTransitionDuration=4.8*clamp(tuning.harmonyGlide,.10,2.2)
    }else{
      previousHarmony=null
      harmonyTransitionStart=now
      harmonyTransitionDuration=0
    }
    const harmony=currentHarmony()
    const inversion=harmonyCycle%3
    const glide=Math.max(.38,(4.8*clamp(tuning.harmonyGlide,.10,2.2))/3.0)
    const voiceTypes=padTypes()
    for(let i=0;i<padVoices.length;i++){
      const voice=padVoices[i]
      voice.type=voiceTypes[i%voiceTypes.length]
      let midi=harmony.pad[i%harmony.pad.length]+Math.round(tuning.padOctave)*12
      if(i===padVoices.length-1&&inversion===1)midi+=12
      if(i===3&&inversion===2)midi+=12
      const target=midiHz(midi)
      voice.frequency.cancelScheduledValues(now)
      voice.frequency.setTargetAtTime(target,now,glide+i*.08)
    }
    if(bassVoice){bassVoice.type=bassType();bassVoice.frequency.cancelScheduledValues(now);bassVoice.frequency.setTargetAtTime(midiHz(bassMidiFor(harmony)),now,Math.max(.22,glide*.58))}
    humFilter.frequency.cancelScheduledValues(now)
    humFilter.frequency.setTargetAtTime(980+harmony.brightness*1180,now,glide*1.12)
    if(bassFilter)bassFilter.frequency.setTargetAtTime(150+harmony.brightness*75,now,glide*.72)
    nextHarmonyAt=now+harmony.hold/Math.max(.35,tuning.musicRate)
  }

  const serviceBackgroundAudio=()=>{
    if(!ctx||ctx.state!=="running")return
    const now=ctx.currentTime
    if(now>=nextHarmonyAt)applyHarmony(now,true)
  }

  const ensure=()=>{
    if(ctx)return
    ctx=new AudioCtor()

    compressor=ctx.createDynamicsCompressor()
    compressor.threshold.value=-20
    compressor.knee.value=20
    compressor.ratio.value=3.6
    compressor.attack.value=.012
    compressor.release.value=.56
    compressor.connect(ctx.destination)

    master=ctx.createGain()
    master.gain.value=.0001
    master.connect(compressor)

    reverbInput=ctx.createGain()
    reverbInput.gain.value=.30
    reverb=ctx.createConvolver()
    reverb.buffer=createReverbImpulse(ctx)
    reverbOutput=ctx.createGain()
    reverbOutput.gain.value=.48*tuning.reverb
    reverbInput.connect(reverb)
    reverb.connect(reverbOutput)
    reverbOutput.connect(compressor)

    humFilter=ctx.createBiquadFilter()
    humFilter.type="lowpass"
    humFilter.frequency.value=1450
    humFilter.Q.value=.54

    humGain=ctx.createGain()
    humGain.gain.value=.0001
    humGain.connect(humFilter)
    humFilter.connect(master)
    humFilter.connect(reverbInput)

    bassFilter=ctx.createBiquadFilter()
    bassFilter.type="lowpass"
    bassFilter.frequency.value=185
    bassFilter.Q.value=.72
    bassGain=ctx.createGain()
    bassGain.gain.value=.0001
    bassGain.connect(bassFilter)
    bassFilter.connect(master)
    // Keep bass mostly dry so the chord pad remains a separate celestial layer.
    const bassVerb=ctx.createGain();bassVerb.gain.value=.13;bassFilter.connect(bassVerb);bassVerb.connect(reverbInput)

    // One continuous air layer: a fixed low cut prevents rumble, while the high cut opens
    // with measured particle activity. At rest it is quiet and dark; collisions make the
    // exact same noise source louder, brighter and more immediate instead of adding a burst.
    motionHighpass=ctx.createBiquadFilter()
    motionHighpass.type="highpass"
    motionHighpass.frequency.value=125
    motionHighpass.Q.value=.32
    motionFilter=ctx.createBiquadFilter()
    motionFilter.type="lowpass"
    motionFilter.frequency.value=tuning.noiseIdleCutoff
    motionFilter.Q.value=.52

    motionGain=ctx.createGain()
    motionGain.gain.value=.0001
    motionGain.connect(motionHighpass)
    motionHighpass.connect(motionFilter)
    motionFilter.connect(master)
    motionFilter.connect(reverbInput)

    noiseBuffer=createNoiseBuffer(ctx,2.4)
    motionSource=ctx.createBufferSource()
    motionSource.buffer=noiseBuffer
    motionSource.loop=true
    motionSource.connect(motionGain)
    motionSource.start()

    activeProgression=Math.round(clamp(tuning.progression,0,PROGRESSIONS.length-1))
    const first=currentHarmony()
    const types=padTypes()
    const detunes=[-5,3,0,6,-3]
    padVoices=first.pad.map((midi,index)=>{
      const osc=ctx!.createOscillator()
      osc.type=types[index%types.length]
      osc.frequency.value=midiHz(midi+Math.round(tuning.padOctave)*12)
      osc.detune.value=detunes[index%detunes.length]
      osc.connect(humGain!)
      osc.start()
      return osc
    })
    bassVoice=ctx.createOscillator()
    bassVoice.type=bassType()
    bassVoice.frequency.value=midiHz(bassMidiFor(first))
    bassVoice.connect(bassGain!)
    bassVoice.start()

    lfo=ctx.createOscillator()
    lfo.frequency.value=.073
    lfoGain=ctx.createGain()
    lfoGain.gain.value=5.5
    lfo.connect(lfoGain)
    if(padVoices[1])lfoGain.connect(padVoices[1].detune)
    if(padVoices[3])lfoGain.connect(padVoices[3].detune)
    lfo.start()

    const now=ctx.currentTime
    nextHarmonyAt=now+first.hold/Math.max(.35,tuning.musicRate)
    lastAudioStepAt=now
    backgroundTimer=window.setInterval(serviceBackgroundAudio,320)
  }

  const nearestScaleInterval=(scale:number[],targets:number[])=>{
    let best=scale[0]??0,bestDistance=99
    for(const candidate of scale){for(const target of targets){const distance=Math.abs(candidate-target);if(distance<bestDistance){bestDistance=distance;best=candidate}}}
    return best
  }
  const chordDegreesFor=(harmony:HarmonyStep)=>{
    const degrees:number[]=[]
    for(const midi of harmony.pad){
      const degree=((midi%12)-harmony.rootPc+12)%12
      if(harmony.scale.includes(degree)&&!degrees.includes(degree))degrees.push(degree)
    }
    if(!degrees.includes(0)&&harmony.scale.includes(0))degrees.unshift(0)
    return degrees.length?degrees:[0]
  }
  const registerAwareMidi=(harmony:HarmonyStep,noteSeed:number,energy:number,preferHigh:boolean,forceLow:boolean,avoidMidi:number|null=null,octaveBias=0)=>{
    const minOct=Math.round(clamp(tuning.chimeMinOctave,2,5))
    const maxOct=Math.round(clamp(tuning.chimeMaxOctave,Math.max(5,minOct+1),8))
    const hash=fract(Math.sin((noteSeed+1.37)*12.9898+harmonyIndex*5.73+ambientCounter*.91)*43758.5453)
    const hash2=fract(Math.sin((noteSeed+7.11)*21.371+harmonyCycle*3.17)*21842.331)
    let normalized=.22+energy*.42+hash*.30-(clamp(tuning.lowChimeBias,.35,1.65)-1)*.18+clamp(octaveBias,-1,1)*.28
    if(forceLow)normalized=.04+hash*.23
    else if(preferHigh)normalized=.70+hash*.30
    normalized=clamp(normalized,0,1)
    const octave=Math.round(minOct+(maxOct-minOct)*normalized)
    const span=Math.max(1,maxOct-minOct)
    const registerPhase=clamp(((octave-minOct)/span)*clamp(tuning.registerOpenness,.55,1.45),0,1)
    // Register-aware harmonic aperture (the musical "lower interval limit" idea):
    // low octaves stay open/root-heavy; progressively more scale degrees are admitted upward.
    let allowedCount=1
    if(registerPhase>=.18)allowedCount=2
    if(registerPhase>=.36)allowedCount=3
    if(registerPhase>=.56)allowedCount=5
    if(registerPhase>=.76)allowedCount=6
    if(registerPhase>=.94)allowedCount=7
    const reveal=[
      nearestScaleInterval(harmony.scale,[0]),
      nearestScaleInterval(harmony.scale,[7]),
      nearestScaleInterval(harmony.scale,[3,4]),
      nearestScaleInterval(harmony.scale,[8,9]),
      nearestScaleInterval(harmony.scale,[10,11]),
      nearestScaleInterval(harmony.scale,[1,2]),
      nearestScaleInterval(harmony.scale,[5,6]),
    ]
    const unique:number[]=[]
    for(const degree of reveal){if(harmony.scale.includes(degree)&&!unique.includes(degree))unique.push(degree)}
    for(const degree of harmony.scale){if(!unique.includes(degree))unique.push(degree)}
    const allowed=unique.slice(0,Math.min(unique.length,allowedCount))
    const chordDegrees=chordDegreesFor(harmony)
    const chordAllowed=allowed.filter(degree=>chordDegrees.includes(degree))
    const chordHash=fract(Math.sin((noteSeed+3.41)*31.171+harmonyIndex*2.93+harmonyCycle*.77)*13579.2468)
    const candidates=chordAllowed.length&&chordHash<clamp(tuning.chimeChordFocus,0,1)?chordAllowed:allowed
    let degreeIndex=Math.floor(hash2*candidates.length)%Math.max(1,candidates.length)
    let degree=candidates[degreeIndex]??0
    let midi=clamp((octave+1)*12+harmony.rootPc+degree,24,116)
    // Continuous physical contact used to quantize to the same note seed for many
    // consecutive frames. Prefer a neighbouring legal scale degree (or octave when the
    // low-register aperture intentionally exposes only the root) instead of repeating
    // the exact same pitch. Harmony rules still remain authoritative.
    if(avoidMidi!==null&&midi===avoidMidi){
      if(candidates.length>1){
        degreeIndex=(degreeIndex+1+(Math.floor(hash*11)%Math.max(1,candidates.length-1)))%candidates.length
        degree=candidates[degreeIndex]??degree
        midi=clamp((octave+1)*12+harmony.rootPc+degree,24,116)
      }else{
        const up=midi+12,down=midi-12
        if(up<=116&&up<=(maxOct+1)*12+harmony.rootPc+11)midi=up
        else if(down>=24)midi=down
      }
    }
    return midi
  }

  const orderedSweepMidi=(harmony:HarmonyStep,position:number,octaveBias:number,spanOctaves:number)=>{
    const minOct=Math.round(clamp(tuning.chimeMinOctave,2,5))
    const maxOct=Math.round(clamp(tuning.chimeMaxOctave,Math.max(5,minOct+1),8))
    const chordDegrees=chordDegreesFor(harmony)
    const colorDegrees=harmony.scale.filter(degree=>!chordDegrees.includes(degree))
    const colorCount=Math.floor((1-clamp(tuning.chimeChordFocus,0,1))*colorDegrees.length+1e-6)
    const sweepDegrees=[...chordDegrees,...colorDegrees.slice(0,colorCount)].sort((a,b)=>a-b)
    const notes:number[]=[]
    for(let octave=minOct;octave<=maxOct;octave++){
      for(const degree of sweepDegrees){
        const midi=(octave+1)*12+harmony.rootPc+degree
        if(midi>=24&&midi<=116)notes.push(midi)
      }
    }
    if(!notes.length)return 72
    const wanted=Math.max(4,Math.round(clamp(spanOctaves,.75,4.5)*Math.max(4,harmony.scale.length)))
    const centerNorm=clamp(.5+clamp(octaveBias,-2,2)*.30,0,1)
    const center=Math.round(centerNorm*(notes.length-1))
    let lo=Math.max(0,center-Math.floor(wanted/2))
    let hi=Math.min(notes.length-1,lo+wanted-1)
    lo=Math.max(0,hi-wanted+1)
    const index=Math.round(mix(lo,hi,clamp(position,0,1)))
    return notes[index]??notes[Math.floor(notes.length/2)]
  }

  const reserveBellAttack=(requested:number,energy:number,scheduler:"physics"|"sweep"="physics")=>{
    if(!ctx)return null
    const now=ctx.currentTime
    // Physics chimes and orchestral sweep chimes have completely independent attack
    // schedulers. A dense sweep can therefore never consume the passive/active chime
    // spacing budget (or vice versa). The sweep keeps only a tiny safety separation;
    // its musical spacing is authored by the sweep traversal itself.
    const attacks=scheduler==="sweep"?scheduledSweepAttacks:scheduledBellAttacks
    const filtered=attacks.filter(time=>time>now-.08&&time<now+.92)
    if(scheduler==="sweep")scheduledSweepAttacks=filtered
    else scheduledBellAttacks=filtered
    const minGap=scheduler==="sweep"?.004:clamp(tuning.chimeMinDelay,0,.35)
    let candidate=Math.max(requested,now+.002)
    const occupied=[...filtered].sort((a,b)=>a-b)
    for(let pass=0;pass<14;pass++){
      const conflict=occupied.find(time=>Math.abs(time-candidate)<minGap)
      if(conflict===undefined)break
      candidate=conflict+minGap
    }
    if(candidate-now>.42||candidate-requested>.38)return null
    if(scheduler==="sweep")scheduledSweepAttacks.push(candidate)
    else scheduledBellAttacks.push(candidate)
    return candidate
  }

  const emitBell=(noteSeed:number,intensity:number,pan:number,preferHigh=false,delay=0,forceLow=false,avoidMidi:number|null=null,gainScale=1,octaveBias=0,forcedMidi:number|((harmony:HarmonyStep)=>number)|null=null,scheduler:"physics"|"sweep"="physics")=>{
    if(!ctx||!master)return null
    const energy=clamp(intensity,0,1)
    const requested=ctx.currentTime+Math.max(0,delay)
    const start=reserveBellAttack(requested,energy,scheduler)
    if(start===null)return null

    const harmony=bellHarmony(start)
    const midi=typeof forcedMidi==="function"?forcedMidi(harmony):(forcedMidi??registerAwareMidi(harmony,noteSeed,energy,preferHigh,forceLow,avoidMidi,octaveBias))
    const octave=Math.floor(midi/12)-1
    const chooseLow=octave<=Math.round((tuning.chimeMinOctave+tuning.chimeMaxOctave)*.5)
    const freq=midiHz(midi)

    const gain=ctx.createGain()
    const bellEnergy=Math.pow(energy,1.28)
    const registerGain=chooseLow?1.08:1
    const bellPeak=(.0085+bellEnergy*.145)*registerGain*tuning.chimeVolume*clamp(gainScale,0,4.5)
    gain.gain.setValueAtTime(.0001,start)
    gain.gain.exponentialRampToValueAtTime(bellPeak,start+.011)
    gain.gain.exponentialRampToValueAtTime(.00012,start+1.75+bellEnergy*1.30)

    const filter=ctx.createBiquadFilter()
    filter.type="bandpass"
    filter.Q.value=chooseLow?1.05:1.45
    filter.frequency.value=freq*(chooseLow?1.08:1.28)

    const panner=("createStereoPanner" in ctx)?ctx.createStereoPanner():null
    if(panner)panner.pan.value=clamp(pan,-1,1)

    const osc=ctx.createOscillator()
    const harmonic=ctx.createOscillator()
    const shimmer=ctx.createOscillator()
    const shimmerGain=ctx.createGain()
    osc.type=chooseLow?"sine":"triangle"
    harmonic.type="sine"
    shimmer.type="sine"
    osc.frequency.value=freq
    harmonic.frequency.value=freq*(chooseLow?2.001:2.003)
    shimmer.frequency.value=freq*(chooseLow?3.002:3.997)
    shimmerGain.gain.value=(chooseLow?.015:.026)+bellEnergy*(chooseLow?.065:.105)

    osc.connect(filter)
    harmonic.connect(filter)
    shimmer.connect(shimmerGain)
    shimmerGain.connect(gain)
    filter.connect(gain)

    if(panner){
      gain.connect(panner)
      panner.connect(master)
      if(reverbInput)panner.connect(reverbInput)
    }else{
      gain.connect(master)
      if(reverbInput)gain.connect(reverbInput)
    }

    osc.start(start)
    harmonic.start(start)
    shimmer.start(start)
    const stop=start+2.55+energy*1.15
    osc.stop(stop)
    harmonic.stop(stop)
    shimmer.stop(stop)
    return midi
  }

  const emitGestureSweep=(kind:"wave"|"vortex",x:number,intensity:number)=>{
    if(!ctx||tuning.sweepChimeEnabled<.5||tuning.sweepChimeVolume<=.001)return
    gestureSweepCounter++
    const density=clamp(tuning.sweepChimeRate,.25,6)
    const energy=clamp(intensity,0,1)
    const count=Math.max(3,Math.min(22,Math.round((kind==="wave"?3.5:5.0)+density*1.55+energy*3.2)))
    const direction=kind==="vortex"?(gestureSweepCounter%2?1:-1):(x>=0?-1:1)
    const startPos=clamp((x+1)*.5,0,1)
    const span=kind==="wave"?(.34+energy*.28):(.54+energy*.36)
    const stepDelay=kind==="wave"?.021:.026
    for(let i=0;i<count;i++){
      const linear=count<=1?0:i/(count-1)
      // A shockwave is radial, so its mark-tree gesture alternates out to both sides of the
      // impact point. A vortex remains a continuous ordered sweep, like a spiral through bars.
      const waveStep=Math.ceil((i+1)/2)/Math.max(1,Math.ceil(count/2))
      const waveSide=i%2===0?1:-1
      const signed=kind==="wave"?waveSide*waveStep*span:direction*linear*span
      const position=clamp(startPos+signed,0,1)
      const pan=clamp(x+(position-startPos)*1.25,-1,1)
      const localEnergy=clamp((kind==="wave"?.20:.16)+energy*(kind==="wave"?.46:.40)+(1-linear)*.08,0,.78)
      const gainScale=tuning.sweepChimeVolume*(kind==="wave"?.72:.66)*(1-energy*.05)
      emitBell(5000+gestureSweepCounter*41+i,localEnergy,pan,signed>0,i*stepDelay,false,null,gainScale,tuning.sweepChimeOctaveBias,harmony=>orderedSweepMidi(harmony,position,tuning.sweepChimeOctaveBias,tuning.sweepChimeSpan),"sweep")
    }
  }

  return {
    arm:()=>{ensure();void ctx?.resume()},
    step:(motionActivity,userInteraction,orbit,collisionSignature,collisionMultiplicity,pointerContact,pointerPosition,pointerSpeed)=>{
      if(!ctx||ctx.state!=="running"||!master||!humGain||!humFilter||!motionGain||!motionFilter||padVoices.length===0)return
      const now=ctx.currentTime
      serviceBackgroundAudio()
      const dt=clamp(lastAudioStepAt?now-lastAudioStepAt:1/60,.001,.08)
      lastAudioStepAt=now

      const harmony=currentHarmony()
      const breathe=.5+.5*Math.sin(now*.17+harmonyIndex*.8)
      const motion=clamp(motionActivity*tuning.collisionAcoustics,0,1)
      // Gesture excitation exists only to bridge the first few frames of a click/touch before
      // the simulation has accumulated measurable motion. After that, the physics meter owns
      // the active state. There is no long synthetic chime/noise tail here.
      gestureExcitation*=Math.exp(-dt*13.5)
      const causalPhysics=activityContrast(clamp(userInteraction*tuning.collisionAcoustics,0,1),tuning.activeActivityContrast)
      const direct=clamp(causalPhysics+gestureExcitation*.38,0,1)
      const visualChaos=clamp(motion*.72+collisionMultiplicity*.66,0,1)
      const gateTarget=direct<.001?0:clamp(direct,0,1)
      const gateCoeff=1-Math.exp(-dt*(gateTarget>activeGestureEnvelope?20:13))
      activeGestureEnvelope+=(gateTarget-activeGestureEnvelope)*gateCoeff
      if(gateTarget===0&&activeGestureEnvelope<.0015)activeGestureEnvelope=0
      const activeGate=clamp(activeGestureEnvelope,0,1)
      const activeChaos=clamp(activeGate*(direct*.34+visualChaos*.96+collisionMultiplicity*.34),0,1)
      const passiveDrive=clamp(motion*(1-activeGate*.28)+collisionMultiplicity*.08*(1-activeGate),0,1)

      const rawTurbulence=clamp(motion*.24+activeChaos*.92+direct*.16,0,1)
      const turbulenceRate=rawTurbulence>turbulenceEnvelope?(1-Math.exp(-dt*9.5)):(1-Math.exp(-dt*2.8))
      turbulenceEnvelope+=(rawTurbulence-turbulenceEnvelope)*turbulenceRate
      const turbulence=clamp(turbulenceEnvelope,0,1)

      // AIR: passive motion and active user-caused chaos are two contributions to ONE source.
      // Passive movement can keep a muffled bed alive, but the active contribution is strictly
      // gated by activeGate. Therefore no pointer/wave/vortex history = exactly zero active air.
      const motionAir=clamp(motion*tuning.noiseMotionSensitivity,0,1)
      const passiveAirDrive=Math.pow(motionAir,Math.max(.12,tuning.noiseResponse))
      const activeAirDrive=Math.pow(clamp(activeChaos*tuning.noiseChaosSensitivity,0,1),Math.max(.12,tuning.noiseResponse))
      const activeAirTarget=activeGate>0?activeGate*mix(tuning.noiseActiveMin,tuning.noiseMax,activeAirDrive):0
      const releaseSeconds=clamp(tuning.noiseRelease,.03,.8)
      const noiseCoeff=activeAirTarget>physicalNoiseEnvelope?(1-Math.exp(-dt/.035)):(1-Math.exp(-dt/releaseSeconds))
      physicalNoiseEnvelope+=(activeAirTarget-physicalNoiseEnvelope)*noiseCoeff
      if(activeAirTarget<=0&&physicalNoiseEnvelope<.002)physicalNoiseEnvelope=0
      // Passive air must be genuinely audible: it is the sound of the particle body moving,
      // not a token DC-like floor. Motion scales both level and a modest passive filter opening.
      // Active chaos then adds a much larger gain/brightness range on top of the same source.
      const passiveAir=.0090*tuning.noiseFloor*(.22+passiveAirDrive*.78)
      const chaosGain=.118*physicalNoiseEnvelope
      const passiveCutoff=Math.min(tuning.noiseActiveCutoff*.72,tuning.noiseIdleCutoff*(1+passiveAirDrive*.95))
      const cutoffDrive=clamp(activeGate*activeAirDrive,0,1)
      const cutoff=mix(passiveCutoff,tuning.noiseActiveCutoff,Math.pow(cutoffDrive,.72))

      master.gain.setTargetAtTime(.23+turbulence*.13,now,.26)
      humGain.gain.setTargetAtTime((.032+orbit*.018+breathe*.008+turbulence*.006)*tuning.padVolume,now,.8)
      if(bassGain)bassGain.gain.setTargetAtTime((.025+orbit*.006+turbulence*.003)*tuning.bassVolume,now,.74)
      humFilter.frequency.setTargetAtTime(980+harmony.brightness*1180+orbit*260+turbulence*180,now,.95)
      if(bassFilter)bassFilter.frequency.setTargetAtTime(150+harmony.brightness*75+turbulence*24,now,.75)
      const airOpening=activeAirTarget>physicalNoiseEnvelope
      motionGain.gain.setTargetAtTime(passiveAir+chaosGain,now,airOpening?.035:Math.max(.025,tuning.noiseRelease*.45))
      motionFilter.frequency.setTargetAtTime(cutoff,now,airOpening?.045:Math.max(.035,tuning.noiseRelease*.55))
      motionFilter.Q.setTargetAtTime(.46+cutoffDrive*.20,now,.20)

      const physicalDrive=clamp(motionAir*.46+activeChaos*.82,0,1)
      const physicalRise=Math.max(0,physicalDrive-previousPhysicalDrive)
      previousPhysicalDrive=physicalDrive
      const signatureNovelty=Math.min(.5,Math.abs(collisionSignature-previousCollisionSignature))

      // PASSIVE LAYER: stochastic, frame-rate-independent bell probability derived from
      // the horse's own particle travel, reconvergence and sampled particle impacts.
      const passiveActivity=clamp(.012+passiveDrive*.88+collisionMultiplicity*.12,0,1)
      const passiveShaped=Math.pow(passiveActivity,Math.max(.2,tuning.passiveChimeResponse))
      const passiveHz=tuning.passiveChimeRate*(.045+passiveShaped*1.28)
      const passiveChance=1-Math.exp(-passiveHz*dt)
      const passiveGap=clamp(tuning.chimeMinDelay,0,.35)
      if(tuning.passiveChimeEnabled>=.5&&tuning.passiveChimeVolume>.001&&passiveHz>.001&&now-lastPassiveChimeAt>=passiveGap&&Math.random()<passiveChance){
        ambientCounter++
        const seed=Math.floor(collisionSignature*911)+ambientCounter*13+harmonyIndex*7
        const intensity=clamp(.032+passiveShaped*.18+collisionMultiplicity*.035,0,.34)
        const gainScale=tuning.passiveChimeVolume*(.66+passiveShaped*.42)
        const pan=clamp((collisionSignature*2-1)*.56+Math.sin(ambientCounter*1.31)*.16,-1,1)
        const midi=emitBell(seed,intensity,pan,passiveShaped>.78,0,false,lastPhysicalMidi,gainScale,tuning.passiveChimeOctaveBias)
        if(midi!==null){lastPhysicalMidi=midi;lastChime=now;lastPassiveChimeAt=now;physicalChimeCounter++}
      }

      // ACTIVE LAYER: only wakes from user-created disturbance, but once excited it follows
      // the resulting particle travel/collisions for a natural decay after the pointer leaves.
      const activeRaw=clamp(activeGate*(direct*.52+activeChaos*.92+physicalRise*.34+collisionMultiplicity*.22+signatureNovelty*.12),0,1)
      const activeShaped=clamp(Math.pow(activeRaw,.82)*tuning.activeChimeResponse,0,1)
      const activeHz=activeGate>0?activeGate*mix(tuning.activeChimeMinRate,tuning.activeChimeRate,activeShaped):0
      const activeChance=1-Math.exp(-activeHz*dt)
      const activeGap=clamp(tuning.chimeMinDelay,0,.35)
      const activeGain=activeGate*mix(tuning.activeChimeMinVolume,tuning.activeChimeVolume,activeShaped)
      if(tuning.activeChimeEnabled>=.5&&activeGain>.001&&activeHz>.001&&now-lastActiveChimeAt>=activeGap&&Math.random()<activeChance){
        ambientCounter++
        const seed=Math.floor(clamp(collisionSignature,0,1)*997)+ambientCounter*19+physicalChimeCounter*11
        const intensity=clamp(.06+activeShaped*.78+collisionMultiplicity*.10,0,1)
        const gainScale=activeGain*(.70+activeShaped*.58)
        const pan=clamp((collisionSignature*2-1)*.72+Math.sin(now*.67)*.10,-1,1)
        const midi=emitBell(seed,intensity,pan,activeShaped>.58,0,false,lastPhysicalMidi,gainScale,tuning.activeChimeOctaveBias)
        if(midi!==null){
          lastPhysicalMidi=midi;lastChime=now;lastActiveChimeAt=now;physicalChimeCounter++
          // At genuinely dense impacts, a quiet neighbouring strike makes one physical
          // event read as several nearby particles rather than one synthetic trigger.
          const clusterChance=clamp((collisionMultiplicity-.30)*.70+(activeShaped-.76)*.72,0,.48)
          if(Math.random()<clusterChance){
            const companion=emitBell(seed+7,intensity*.55,-pan*.68,true,0,false,lastPhysicalMidi,gainScale*.52,tuning.activeChimeOctaveBias)
            if(companion!==null){lastPhysicalMidi=companion;physicalChimeCounter++}
          }
        }
      }

      // ORCHESTRAL SWEEP / MARK-TREE LAYER: pointer travel across actual particle contact
      // crosses ordered virtual chime bars. Direction reverses the melodic sweep naturally.
      const sweepContact=clamp(pointerContact*tuning.sweepContactSensitivity,0,1)
      const sweepHot=tuning.sweepChimeEnabled>=.5&&tuning.sweepChimeVolume>.001&&sweepContact>.018&&pointerSpeed>.018
      if(sweepHot){
        const laneCount=Math.max(6,Math.min(102,Math.round(6+tuning.sweepChimeRate*16)))
        const normalizedPointer=clamp((pointerPosition+1)*.5,0,1)
        const lane=Math.round(normalizedPointer*(laneCount-1))
        if(lastSweepLane===null)lastSweepLane=lane
        else if(lane!==lastSweepLane){
          const direction=lane>lastSweepLane?1:-1
          const crossings=Math.min(Math.abs(lane-lastSweepLane),Math.max(1,Math.round(1+pointerSpeed*4)))
          for(let n=1;n<=crossings;n++){
            const crossed=lastSweepLane+direction*n
            const position=clamp(crossed/Math.max(1,laneCount-1),0,1)
            const intensity=clamp(.08+sweepContact*.38+pointerSpeed*.26,0,.72)
            const gainScale=tuning.sweepChimeVolume*(.68+sweepContact*.52)
            const sweepDelay=.028*(n-1)
            emitBell(3000+crossed+ambientCounter*3,intensity,pointerPosition,direction>0,sweepDelay,false,null,gainScale,tuning.sweepChimeOctaveBias,harmony=>orderedSweepMidi(harmony,position,tuning.sweepChimeOctaveBias,tuning.sweepChimeSpan),"sweep")
          }
          lastSweepLane=lane
          lastSweepContactAt=now
        }
      }else if(now-lastSweepContactAt>.16){
        lastSweepLane=null
      }

      if(now-lastChime>3.4)lastPhysicalMidi=null
      previousCollisionSignature=collisionSignature
    },
    trigger:(kind,x,intensity)=>{
      ensure()
      void ctx?.resume()
      void x
      // Gestures excite the active envelope; actual bell timing still obeys Active Rate,
      // so clicks/waves cannot bypass the user's layer controls.
      const lift=kind==="wave"?1:kind==="vortex"?.90:.28
      gestureExcitation=Math.max(gestureExcitation,clamp(intensity*lift,0,1))
      if(kind==="wave"||kind==="vortex")emitGestureSweep(kind,x,intensity)
    },
    idle:()=>{
      if(!ctx||ctx.state!=="running"||!master||!humGain||!motionGain||!motionFilter)return
      const now=ctx.currentTime
      turbulenceEnvelope*=.25
      physicalNoiseEnvelope=0
      previousPhysicalDrive=0
      activeGestureEnvelope=0
      gestureExcitation=0
      lastSweepLane=null
      master.gain.setTargetAtTime(.19,now,.7)
      humGain.gain.setTargetAtTime(.026*tuning.padVolume,now,.9)
      bassGain?.gain.setTargetAtTime(.019*tuning.bassVolume,now,.9)
      motionGain.gain.setTargetAtTime(.00008*tuning.noiseFloor,now,Math.max(.04,tuning.noiseRelease*.35))
      motionFilter.frequency.setTargetAtTime(tuning.noiseIdleCutoff,now,Math.max(.05,tuning.noiseRelease*.45))
    },
    configure:(next)=>{
      const updated=sanitizeTuning(next)
      const progressionChanged=Math.round(updated.progression)!==activeProgression
      const voicingChanged=updated.padOctave!==tuning.padOctave||updated.padTimbre!==tuning.padTimbre||updated.bassOctave!==tuning.bassOctave||updated.bassWave!==tuning.bassWave
      tuning=updated
      activeProgression=Math.round(tuning.progression)
      if(ctx&&reverbOutput)reverbOutput.gain.setTargetAtTime(.48*tuning.reverb,ctx.currentTime,.45)
      if(tuning.sweepChimeEnabled<.5)lastSweepLane=null
      if(ctx&&(progressionChanged||voicingChanged)){
        if(progressionChanged){harmonyIndex=0;harmonyCycle=0;previousHarmony=null}
        applyHarmony(ctx.currentTime,false)
      }
    },
    dispose:()=>{
      if(backgroundTimer!=null){window.clearInterval(backgroundTimer);backgroundTimer=null}
      for(const voice of padVoices)voice.stop()
      bassVoice?.stop();bassVoice=null
      lfo?.stop();motionSource?.stop();ctx?.close().catch(()=>undefined)
      padVoices=[]
      ctx=null
    }
  }
}

let persistentParticleHorseAudio:AudioEngine|null=null
let particleHorseAssetSubscription:(()=>void)|null=null
function getPersistentParticleHorseAudioEngine(){
  if(!persistentParticleHorseAudio)persistentParticleHorseAudio=createParticleHorseAudioEngine()
  if(!particleHorseAssetSubscription){
    particleHorseAssetSubscription=subscribeHeritageVisualAssets(()=>{
      if(getHeritageVisualAssets().splashArt!=="particle-horse"&&persistentParticleHorseAudio){
        persistentParticleHorseAudio.dispose()
        persistentParticleHorseAudio=null
      }
    })
  }
  return persistentParticleHorseAudio
}

function TuningSlider({locale,spec,value,onChange}:{locale:Locale;spec:SliderSpec;value:number;onChange:(value:number)=>void}){
  const digits=spec.step>=1?0:spec.step>=.1?1:2
  return <label className="particle-horse-tune-row"><span>{locale==="fa"?spec.labelFa:spec.label}</span><input type="range" min={spec.min} max={spec.max} step={spec.step} value={value} onChange={event=>onChange(Number(event.currentTarget.value))}/><output>{value.toFixed(digits)}{spec.unit??""}</output></label>
}

function TuningSelect({locale,spec,value,onChange}:{locale:Locale;spec:SelectSpec;value:number;onChange:(value:number)=>void}){
  return <label className="particle-horse-select-row"><span>{locale==="fa"?spec.labelFa:spec.label}</span><select value={String(value)} onChange={event=>onChange(Number(event.currentTarget.value))}>{spec.options.map(option=><option key={`${spec.key}-${option.value}`} value={String(option.value)}>{locale==="fa"?option.labelFa:option.label}</option>)}</select>{spec.hint&&<small>{locale==="fa"?spec.hintFa:spec.hint}</small>}</label>
}

type LabTab="look"|"physics"|"sound"|"music"
function ParticleHorseTuner({locale,tuning,onChange,onPreset,onReset,onClose}:{locale:Locale;tuning:ParticleHorseTuning;onChange:(key:keyof ParticleHorseTuning,value:number)=>void;onPreset:(name:string)=>void;onReset:()=>void;onClose:()=>void}){
  const [note,setNote]=useState("")
  const [tab,setTab]=useState<LabTab>("look")
  const [presetChoice,setPresetChoice]=useState(()=>sameTuning(tuning,DEFAULT_TUNING)?"approved":sameTuning(tuning,HERITAGE_TUNING)?"heritage":"custom")
  const fileRef=useRef<HTMLInputElement>(null)
  const flash=(message:string)=>{setNote(message);window.setTimeout(()=>setNote(""),1500)}
  const change=(key:keyof ParticleHorseTuning,value:number)=>{setPresetChoice("custom");onChange(key,value)}
  const applyJson=(text:string)=>{try{const parsed=sanitizeTuning(JSON.parse(text));for(const key of Object.keys(parsed) as Array<keyof ParticleHorseTuning>)onChange(key,parsed[key]);setPresetChoice("custom");flash(uiText(locale, "JSON APPLIED", "JSON اعمال شد"))}catch{flash(uiText(locale, "INVALID JSON", "JSON نامعتبر"))}}
  const copyJson=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(tuning,null,2));flash(uiText(locale, "JSON COPIED", "JSON کپی شد"))}catch{flash(uiText(locale, "COPY FAILED", "کپی ناموفق"))}}
  const pasteJson=async()=>{try{applyJson(await navigator.clipboard.readText())}catch{flash(uiText(locale, "CLIPBOARD BLOCKED", "دسترسی کلیپ‌بورد ممکن نیست"))}}
  const saveJson=()=>{const blob=new Blob([JSON.stringify(tuning,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="horse-db-particle-tuning.json";a.click();URL.revokeObjectURL(url);flash(uiText(locale, "JSON SAVED", "JSON ذخیره شد"))}
  const saveLocal=()=>{try{localStorage.setItem(TUNING_STORAGE_KEY,JSON.stringify(tuning));flash(uiText(locale, "SAVED AS DEFAULT", "به‌عنوان پیش‌فرض ذخیره شد"))}catch{flash(uiText(locale, "SAVE FAILED", "ذخیره ناموفق"))}}
  const loadFile=(event:React.ChangeEvent<HTMLInputElement>)=>{const file=event.currentTarget.files?.[0];event.currentTarget.value="";if(file)void file.text().then(applyJson)}
  const sliderRows=(specs:SliderSpec[])=>specs.map(spec=><TuningSlider key={spec.key} locale={locale} spec={spec} value={tuning[spec.key]} onChange={value=>change(spec.key,value)}/>)
  const selectRows=(specs:SelectSpec[])=>specs.map(spec=><TuningSelect key={spec.key} locale={locale} spec={spec} value={tuning[spec.key]} onChange={value=>change(spec.key,value)}/>)
  const group=(title:string,titleFa:string,children:React.ReactNode,open=true,caption?:string,captionFa?:string)=><details className="particle-horse-tune-group" data-h-surface-role="control" open={open}><summary><span>{locale==="fa"?titleFa:title}</span><i aria-hidden="true">⌄</i></summary>{caption&&<p>{locale==="fa"?captionFa:caption}</p>}<div>{children}</div></details>
  const progressionSpec:SelectSpec={key:"progression",label:"Chord progression",labelFa:"پیشروی آکورد",options:MUSIC_PROGRESSION_OPTIONS.map((option,index)=>({value:index,label:option.label,labelFa:option.labelFa}))}
  const tabs:Array<{id:LabTab;label:string;labelFa:string}>=[
    {id:"look",label:"LOOK",labelFa:"ظاهر"},{id:"physics",label:"PHYSICS",labelFa:"فیزیک"},{id:"sound",label:"SOUND",labelFa:"صدا"},{id:"music",label:"MUSIC",labelFa:"موسیقی"},
  ]
  return <aside className="particle-horse-tuner" dir={(isUiRtl(locale) ? "rtl" : "ltr")} data-locale={locale} data-lab-tab={tab} data-h-surface-role="card" onPointerDown={event=>event.stopPropagation()} onContextMenu={event=>event.stopPropagation()}>
    <header><div><strong>{uiText(locale, "PARTICLE LAB", "آزمایشگاه ذرات")}</strong><small>{uiText(locale, "LIVE CONTROL · VISUAL · PHYSICS · AUDIO", "کنترل زنده · ظاهر · فیزیک · صدا")}</small></div><button type="button" onClick={onClose} aria-label={uiText(locale, "Close", "بستن")}>×</button></header>
    <div className="particle-horse-master-preset" data-h-surface-role="control"><label><span>{uiText(locale, "SCENE PRESET", "پریست صحنه")}</span><select value={presetChoice} onChange={event=>{const name=event.currentTarget.value;setPresetChoice(name);if(name!=="custom")onPreset(name)}}><option value="custom">{uiText(locale, "Custom / live", "سفارشی")}</option>{PRESET_OPTIONS.map(option=><option key={option.value} value={option.value}>{locale==="fa"?option.labelFa:option.label}</option>)}</select></label><small>{uiText(locale, "Current approved default is the built-in profile; Heritage original R29.17 preserves the historical pre-Lab look.", "پیش‌فرض تأییدشده، تنظیم فعلی برنامه است؛ «ظاهر اصلی R29.17» ظاهر تاریخی قبل از Lab را نگه می‌دارد.")}</small></div>
    <nav className="particle-horse-lab-tabs" data-h-surface-role="control" aria-label={uiText(locale, "Tuning section", "بخش تنظیمات")}>{tabs.map(item=><button type="button" key={item.id} className={tab===item.id?"active":""} onClick={()=>setTab(item.id)}>{locale==="fa"?item.labelFa:item.label}</button>)}</nav>
    <div className="particle-horse-tune-scroll">
      {tab==="look"&&<>
        {group("Particle form","فرم ذرات",sliderRows(SIZE_SLIDERS),true,"Shape only. The smallest/median/largest controls alter the distribution rather than scaling every particle equally.","فقط فرم ذرات؛ سه کنترل اندازه توزیع را تغییر می‌دهند، نه اینکه همه ذرات یکسان بزرگ یا کوچک شوند.")}
        {group("Color & luminance","رنگ و روشنایی",<>{selectRows([PALETTE_SELECT])}{sliderRows(LIGHT_SLIDERS)}</>,true,"Small and large particles have independent luminance, with optional per-particle randomness.","روشنایی ذرات کوچک و بزرگ مستقل است و می‌توان تصادفی‌بودن هر ذره را نیز تنظیم کرد.")}
        {group("Bloom & atmosphere","بلوم و اتمسفر",sliderRows(BLOOM_SLIDERS),true,"Global bloom shapes the broad atmosphere. Fine emissive bloom reacts to each particle’s live brightness before display clipping, while the lightweight motion trail reuses the previous particle frame instead of running an expensive full-screen blur.","بلوم کلی فضای گسترده را می‌سازد. بلوم ظریف تابشی به روشنایی لحظه‌ای هر ذره پیش از محدودشدن خروجی نمایش واکنش می‌دهد و رد حرکتی سبک، به‌جای بلور تمام‌صفحه پرهزینه، از فریم قبلی ذرات استفاده می‌کند.")}
      </>}
      {tab==="physics"&&<>
        {group("Field behavior","رفتار میدان",sliderRows(FIELD_SLIDERS),true,"Controls how tightly the cloud belongs to the running surface versus the full welcome field.","میزان وابستگی ابر ذرات به سطح اسب در برابر آزادی در کل فضای خوش‌آمدگویی.")}
        {group("Interaction forces","نیروهای تعاملی",sliderRows(INTERACTION_SLIDERS),true)}
      </>}
      {tab==="sound"&&<>
        {group("Physics-driven air","هوای مبتنی بر فیزیک",sliderRows(ACOUSTIC_SLIDERS),true,"One continuous air source with separate passive and active physics drives. Passive particle travel is always audible according to Passive air level and opens its muffled filter slightly with motion. Active air follows user-caused speed, displacement, reconvergence and collisions, then vanishes as those measured effects settle.","یک منبع پیوسته هوا از مسافت حرکت ذرات و آشفتگی برخوردها پیروی می‌کند؛ حرکت عادی یک نفس خفه را زنده نگه می‌دارد و آشفتگی ناشی از تعامل، صدا و فرکانس‌های بالا را باز می‌کند.")}
        {group("Chime master & register","مستر و رجیستر زنگ",<>{selectRows([REGISTER_SELECT,CHIME_MIN_SELECT,CHIME_MAX_SELECT])}{sliderRows(CHIME_SLIDERS)}</>,true,"Global tone and timing. Chord-tone focus keeps bells anchored to the current pad harmony; minimum spacing is the only intentional global anti-machine-gun delay.","فقط رنگ کلی صدا؛ نرخ تریگر، بلندی و گرایش اکتاو برای هر لایه در بخش‌های پایین مستقل هستند.")}
        {group("Passive physics chimes","زنگ‌های فیزیکی غیرفعال",<>{selectRows([PASSIVE_CHIME_ENABLE_SELECT])}{sliderRows(PASSIVE_CHIME_SLIDERS)}</>,true,"No mouse is required. Real particle travel, reconvergence and sampled particle-to-particle impacts continuously change the probability of a melodic bell. Rate controls event chance; loudness and octave bias are fully independent.","بدون نیاز به موس؛ حرکت واقعی ذرات، بازگشت آن‌ها و برخوردهای نمونه‌برداری‌شده احتمال زنگ موسیقایی را پیوسته تغییر می‌دهند. نرخ، بلندی و گرایش اکتاو مستقل‌اند.")}
        {group("Active chaos chimes","زنگ‌های آشفتگی فعال",<>{selectRows([ACTIVE_CHIME_ENABLE_SELECT])}{sliderRows(ACTIVE_CHIME_SLIDERS)}</>,true,"This layer is owned by user-caused disturbance. Shockwave/vortex/pointer energy stays active while particles remain fast, displaced, reconverging or colliding. Active detection contrast remaps low-vs-high measured activity without changing the underlying physics; 1.00 is neutral.","این لایه فقط با آشفتگی ساخته‌شده توسط کاربر بیدار می‌شود و سپس حرکت و برخوردهای حاصل را پس از عبور نشانگر دنبال می‌کند؛ آشفتگی زیاد می‌تواند زنگ‌های سریع و سینمایی بسازد بدون ریتم مکانیکی ثابت.")}
        {group("Orchestral chime sweep","جاروب زنگ ارکسترال",<>{selectRows([SWEEP_CHIME_ENABLE_SELECT])}{sliderRows(SWEEP_CHIME_SLIDERS)}</>,true,"Optional mark-tree behavior. Pointer traversal, shockwaves and vortices can all excite chord-locked ordered sweeps. The sweep has its own independent scheduler, so it never consumes the passive/active chime spacing budget.","رفتار اختیاری شبیه مارک‌تری؛ وقتی نشانگر واقعاً از میان ذرات عبور می‌کند، ردیفی مرتب و هماهنگ از زنگ‌های مجازی را طی می‌کند و تغییر جهت، جهت ملودی را برعکس می‌کند.")}
      </>}
      {tab==="music"&&<>
        {group("Harmony engine","موتور هارمونی",<>{selectRows([progressionSpec])}{sliderRows(HARMONY_SLIDERS)}</>,true,"Chimes can adopt the next chord before the pad glide has completely settled; handoff timing is adjustable.","زنگ‌ها می‌توانند پیش از پایان کامل اسلاید پد، آکورد بعدی را بپذیرند؛ زمان آن قابل تنظیم است.")}
        {group("Bass foundation","پایه باس",<>{selectRows([BASS_OCTAVE_SELECT,BASS_WAVE_SELECT])}{sliderRows(MIX_SLIDERS.slice(0,1))}</>,true,"Bass is now a distinct low root voice, mostly dry and separated from the chord pad.","باس اکنون صدای ریشه‌ای جداگانه، بم و عمدتاً خشک است و از پد آکورد تفکیک شده است.")}
        {group("Chord pad","پد آکورد",<>{selectRows([PAD_OCTAVE_SELECT,PAD_TIMBRE_SELECT])}{sliderRows(MIX_SLIDERS.slice(1))}</>,true,"The pad plays the full chord in a higher configurable register and carries the celestial reverb.","پد آکورد کامل را در رجیستر بالاتر و قابل انتخاب اجرا می‌کند و ریورب آسمانی را حمل می‌کند.")}
      </>}
    </div>
    <footer data-h-surface-role="control"><button type="button" onClick={copyJson}>{uiText(locale, "COPY JSON", "کپی JSON")}</button><button type="button" onClick={pasteJson}>{uiText(locale, "PASTE", "چسباندن")}</button><button type="button" onClick={saveJson}>{uiText(locale, "SAVE FILE", "ذخیره فایل")}</button><button type="button" onClick={()=>fileRef.current?.click()}>{uiText(locale, "LOAD", "بارگذاری")}</button><button type="button" onClick={saveLocal}>{uiText(locale, "MY DEFAULT", "پیش‌فرض من")}</button><button type="button" onClick={()=>{setPresetChoice("approved");onReset()}}>{uiText(locale, "DEFAULT", "پیش‌فرض")}</button><input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={loadFile}/>{note&&<span>{note}</span>}</footer>
  </aside>
}

export default function ParticleHorseSplash(props:Props){
  if(!PARTICLE_HORSE_MODEL_URL)return null
  return <AvailableParticleHorseSplash {...props}/>
}

function AvailableParticleHorseSplash({locale,cameraOrbit=0}:Props){
  const anchorRef=useRef<HTMLDivElement>(null)
  const hostRef=useRef<HTMLDivElement>(null)
  const canvasRef=useRef<HTMLCanvasElement>(null)
  const audioRef=useRef<AudioEngine|null>(null)
  const syncStageRegistrationRef=useRef<(()=>void)|null>(null)
  const [heroTarget,setHeroTarget]=useState<HTMLElement|null>(null)
  const [tunerOpen,setTunerOpen]=useState(false)
  const [tuning,setTuning]=useState<ParticleHorseTuning>(()=>loadTuning())
  const tuningRef=useRef(tuning)
  const [status,setStatus]=useState<"loading"|"ready"|"error">("loading")
  const [failureKind,setFailureKind]=useState<"webgl"|"shader"|"model"|null>(null)
  const cameraOrbitRef=useRef(cameraOrbit)
  useEffect(()=>{cameraOrbitRef.current=cameraOrbit},[cameraOrbit])
  useEffect(()=>{tuningRef.current=tuning;audioRef.current?.configure(tuning)},[tuning])
  useLayoutEffect(()=>{setHeroTarget(anchorRef.current?.closest(".premium-hero") as HTMLElement|null)},[])
  useLayoutEffect(()=>{
    // Direction changes move the art column without necessarily changing its size.
    // ResizeObserver therefore cannot detect EN <-> FA mirroring by itself. Re-register
    // the WebGL stage against the real art rectangle now and on the next layout frames.
    const sync=()=>syncStageRegistrationRef.current?.()
    sync()
    const frame1=requestAnimationFrame(sync)
    const frame2=requestAnimationFrame(()=>requestAnimationFrame(sync))
    return()=>{cancelAnimationFrame(frame1);cancelAnimationFrame(frame2)}
  },[locale,heroTarget])

  const updateTuning=(key:keyof ParticleHorseTuning,value:number)=>setTuning(current=>sanitizeTuning({...current,[key]:value}))
  const applyPreset=(name:string)=>{const preset=TUNING_PRESETS[name];if(preset)setTuning({...preset})}
  const resetTuning=()=>{try{localStorage.removeItem(TUNING_STORAGE_KEY)}catch{}setTuning({...DEFAULT_TUNING})}

  useEffect(()=>{
    if(!heroTarget)return
    const host=hostRef.current,canvas=canvasRef.current
    if(!host||!canvas)return
    const abort=new AbortController()
    const audio=getPersistentParticleHorseAudioEngine()
    audioRef.current=audio
    audio.configure(tuningRef.current)
    let disposed=false,frame=0,visible=true,pageVisible=!document.hidden,modelReady=false,lastFrame=performance.now(),slowFrames=0,fastFrames=0,drawRatio=1,bloomAllowed=true
    // R135 idle economy: with no pointer nearby and a settled scene the horse
    // drifts slowly — 30fps is indistinguishable from 60 there, and halves the
    // whole CPU morph/physics + GPU draw cost exactly when nothing is looking.
    // The frame limiter only ever skips DRAWS; rAF keeps ticking so recovery
    // to full rate is instant on the next touch/pointer/interaction.
    let lastDrawTime=0,lastMorphTime=-1,idleCapFrames=0
    const reduced=matchMedia("(prefers-reduced-motion: reduce)")
    const coarse=matchMedia("(pointer: coarse)")
    const memory=(navigator as Navigator&{deviceMemory?:number}).deviceMemory??8
    const cores=(navigator as Navigator&{hardwareConcurrency?:number}).hardwareConcurrency??8
    const mobile=innerWidth<720||coarse.matches
    // R32 adaptive quality: three tiers auto-detected from real device signals.
    // The global appearance performance mode (data-perf="lite") can force the
    // lightest tier so weak CPUs / GPU-less laptops stay smooth.
    const forcedLite=document.documentElement.dataset.perf==="lite"
    const qualityTier:"lite"|"balanced"|"high"=forcedLite||memory<=2||cores<=2?"lite":memory<=4||cores<=4||mobile?"balanced":"high"
    const tierParticles=qualityTier==="lite"?(mobile?4200:6400):qualityTier==="balanced"?(mobile?6800:10800):(mobile?8600:14800)
    const tierDust=qualityTier==="lite"?(mobile?900:1500):qualityTier==="balanced"?(mobile?1700:3200):(mobile?2360:4380)
    const tierDprCap=qualityTier==="lite"?(mobile?1.15:1.25):qualityTier==="balanced"?(mobile?1.35:1.5):(mobile?1.65:1.8)
    const particleCount=tierParticles
    const dustCount=tierDust
    const groupCount=Math.max(12,Math.min(34,Math.round(particleCount/340)))
    // Points do not benefit from MSAA; disabling it removes a full-viewport
    // multisample resolve per frame — one of the biggest wins on weak GPUs.
    const contextOptions:WebGLContextAttributes={alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:false,powerPreference:"high-performance"}
    const gl=(canvas.getContext("webgl",contextOptions)||canvas.getContext("webgl")) as WebGLRenderingContext|null
    if(!gl){
      console.error("[ParticleHorse] WebGL context creation failed")
      setFailureKind("webgl")
      setStatus("error")
      return
    }
    let program:WebGLProgram
    try{program=buildProgram(gl)}catch(error){
      console.error("[ParticleHorse] shader/program initialization failed",error)
      setFailureKind("shader")
      setStatus("error")
      return
    }
    let bloomProgram:WebGLProgram|null=null
    try{bloomProgram=buildBloomPostProgram(gl)}catch(error){console.warn("[ParticleHorse] optical bloom post-process unavailable; continuing without it",error)}

    const posLoc=gl.getAttribLocation(program,"aPosition")
    const seedLoc=gl.getAttribLocation(program,"aSeed")
    const scaleLoc=gl.getAttribLocation(program,"aScale")
    const uniforms={
      yaw:gl.getUniformLocation(program,"uYaw"),pitch:gl.getUniformLocation(program,"uPitch"),aspect:gl.getUniformLocation(program,"uAspect"),
      point:gl.getUniformLocation(program,"uPointScale"),opacity:gl.getUniformLocation(program,"uOpacity"),depth:gl.getUniformLocation(program,"uDepthBias"),dark:gl.getUniformLocation(program,"uDark"),sceneScale:gl.getUniformLocation(program,"uSceneScale"),time:gl.getUniformLocation(program,"uTime"),
      stageScale:gl.getUniformLocation(program,"uStageScale"),stageOffset:gl.getUniformLocation(program,"uStageOffset"),
      sizeMin:gl.getUniformLocation(program,"uSizeMin"),sizeMedian:gl.getUniformLocation(program,"uSizeMedian"),sizeMax:gl.getUniformLocation(program,"uSizeMax"),
      smallBrightness:gl.getUniformLocation(program,"uSmallBrightness"),largeBrightness:gl.getUniformLocation(program,"uLargeBrightness"),brightnessRandomness:gl.getUniformLocation(program,"uBrightnessRandomness"),
      winkDepth:gl.getUniformLocation(program,"uWinkDepth"),winkSpeed:gl.getUniformLocation(program,"uWinkSpeed"),winkSpeedRandomness:gl.getUniformLocation(program,"uWinkSpeedRandomness"),winkSizeBias:gl.getUniformLocation(program,"uWinkSizeBias"),
      overallBrightness:gl.getUniformLocation(program,"uOverallBrightness"),saturation:gl.getUniformLocation(program,"uSaturation"),palette:gl.getUniformLocation(program,"uPalette"),renderMode:gl.getUniformLocation(program,"uRenderMode"),fineBloomThreshold:gl.getUniformLocation(program,"uFineBloomThreshold")
    }

    const positionBuffer=gl.createBuffer(),seedBuffer=gl.createBuffer(),scaleBuffer=gl.createBuffer(),dustPositionBuffer=gl.createBuffer(),dustSeedBuffer=gl.createBuffer(),dustScaleBuffer=gl.createBuffer()
    if(!positionBuffer||!seedBuffer||!scaleBuffer||!dustPositionBuffer||!dustSeedBuffer||!dustScaleBuffer){
      console.error("[ParticleHorse] WebGL buffer allocation failed")
      setFailureKind("webgl")
      setStatus("error")
      return
    }

    const bloomQuadBuffer=bloomProgram?gl.createBuffer():null
    const bloomTextureA=bloomProgram?gl.createTexture():null
    const bloomTextureB=bloomProgram?gl.createTexture():null
    const bloomFramebufferA=bloomProgram?gl.createFramebuffer():null
    const bloomFramebufferB=bloomProgram?gl.createFramebuffer():null
    const bloomPosLoc=bloomProgram?gl.getAttribLocation(bloomProgram,"aPosition"):-1
    const bloomUniforms=bloomProgram?{
      texture:gl.getUniformLocation(bloomProgram,"uTexture"),direction:gl.getUniformLocation(bloomProgram,"uDirection"),composite:gl.getUniformLocation(bloomProgram,"uComposite"),intensity:gl.getUniformLocation(bloomProgram,"uIntensity")
    }:null
    let bloomReady=Boolean(bloomProgram&&bloomQuadBuffer&&bloomTextureA&&bloomTextureB&&bloomFramebufferA&&bloomFramebufferB&&bloomPosLoc>=0)
    let bloomWidth=1,bloomHeight=1
    const bloomScale=qualityTier==="lite"?.2:mobile?.24:.30
    if(bloomReady&&bloomQuadBuffer&&bloomTextureA&&bloomTextureB&&bloomFramebufferA&&bloomFramebufferB){
      gl.bindBuffer(gl.ARRAY_BUFFER,bloomQuadBuffer)
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW)
      for(const texture of [bloomTextureA,bloomTextureB]){
        gl.bindTexture(gl.TEXTURE_2D,texture)
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferA);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,bloomTextureA,0)
      gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferB);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,bloomTextureB,0)
      gl.bindFramebuffer(gl.FRAMEBUFFER,null)
    }
    const resizeBloomTargets=()=>{
      if(!bloomReady||!bloomTextureA||!bloomTextureB||!bloomFramebufferA||!bloomFramebufferB)return
      const nextWidth=Math.max(48,Math.floor(canvas.width*bloomScale)),nextHeight=Math.max(48,Math.floor(canvas.height*bloomScale))
      if(nextWidth===bloomWidth&&nextHeight===bloomHeight)return
      bloomWidth=nextWidth;bloomHeight=nextHeight
      for(const texture of [bloomTextureA,bloomTextureB]){
        gl.bindTexture(gl.TEXTURE_2D,texture)
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,bloomWidth,bloomHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,null)
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferA)
      const statusA=gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferB)
      const statusB=gl.checkFramebufferStatus(gl.FRAMEBUFFER)
      gl.bindFramebuffer(gl.FRAMEBUFFER,null)
      if(statusA!==gl.FRAMEBUFFER_COMPLETE||statusB!==gl.FRAMEBUFFER_COMPLETE){bloomReady=false;console.warn("[ParticleHorse] optical bloom framebuffer unavailable; disabling bloom post-process")}
    }

    const positions=new Float32Array(particleCount*3)
    const velocities=new Float32Array(particleCount*3)
    const targets=new Float32Array(particleCount*3)
    let surface:ParticleSurface|null=null
    let base=new Float32Array(),morphs:Float32Array[]=[],morphed=new Float32Array(),weights=new Float32Array(),animation:MorphAnimation|null=null,defaults:Float32Array=new Float32Array()

    const random=xorshift(0x53504852)
    const dustBase=new Float32Array(dustCount*3)
    const dustPositions=new Float32Array(dustCount*3)
    const dustVelocities=new Float32Array(dustCount*3)
    const dustSeeds=new Float32Array(dustCount)
    const dustScales=new Float32Array(dustCount)
    for(let i=0;i<dustCount;i++){
      const z=random()*2-1,a=random()*TAU,r=1.74+random()*.54,s=Math.sqrt(Math.max(0,1-z*z)),o=i*3
      dustBase[o]=Math.cos(a)*s*r
      dustBase[o+1]=z*(1.02+random()*.28)
      dustBase[o+2]=Math.sin(a)*s*r
      dustPositions[o]=dustBase[o]
      dustPositions[o+1]=dustBase[o+1]
      dustPositions[o+2]=dustBase[o+2]
      dustSeeds[i]=random()
      dustScales[i]=.24+random()*.54
    }

    gl.bindBuffer(gl.ARRAY_BUFFER,dustSeedBuffer)
    gl.bufferData(gl.ARRAY_BUFFER,dustSeeds,gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER,dustScaleBuffer)
    gl.bufferData(gl.ARRAY_BUFFER,dustScales,gl.STATIC_DRAW)
    gl.useProgram(program)
    gl.enable(gl.BLEND)
    gl.enable(gl.DEPTH_TEST)
    gl.depthMask(false)
    gl.clearColor(0,0,0,0)

    const artElement=anchorRef.current?.closest(".hero-art") as HTMLElement|null
    const eventSurface=heroTarget
    let width=1,height=1,dpr=1,aspect=1,stageScaleX=1,stageScaleY=1,stageOffsetX=0,stageOffsetY=0
    const resize=()=>{
      const rect=host.getBoundingClientRect()
      const artRect=artElement?.getBoundingClientRect()??rect
      width=Math.max(1,rect.width)
      height=Math.max(1,rect.height)
      const cap=tierDprCap
      dpr=Math.min(devicePixelRatio||1,cap)
      const rw=Math.max(1,Math.floor(width*dpr)),rh=Math.max(1,Math.floor(height*dpr))
      if(canvas.width!==rw||canvas.height!==rh){canvas.width=rw;canvas.height=rh;gl.viewport(0,0,rw,rh);resizeBloomTargets()}
      aspect=Math.max(.12,artRect.width)/Math.max(1,artRect.height)
      stageScaleX=clamp(artRect.width/width,.05,1.4)
      stageScaleY=clamp(artRect.height/height,.05,1.4)
      stageOffsetX=clamp((((artRect.left+artRect.width*.5)-rect.left)/width)*2-1,-1.5,1.5)
      stageOffsetY=clamp(1-((((artRect.top+artRect.height*.5)-rect.top)/height)*2),-1.5,1.5)
      // Keep the soft aura registered to the original art stage even though the WebGL
      // simulation itself spans the whole hero. This preserves the approved R29.17
      // composition while allowing disturbed particles to escape into the mother field.
      const auraX=mobile?.05:.07,auraTop=mobile?.04:.05,auraBottom=mobile?.08:.10
      host.style.setProperty("--ph-aura-left",`${artRect.left-rect.left-artRect.width*auraX}px`)
      host.style.setProperty("--ph-aura-top",`${artRect.top-rect.top-artRect.height*auraTop}px`)
      host.style.setProperty("--ph-aura-width",`${artRect.width*(1+auraX*2)}px`)
      host.style.setProperty("--ph-aura-height",`${artRect.height*(1+auraTop+auraBottom)}px`)
    }
    const resizeObserver=new ResizeObserver(resize)
    resizeObserver.observe(host)
    if(artElement)resizeObserver.observe(artElement)
    syncStageRegistrationRef.current=resize
    resize()

    let yaw=-.42,pitch=.08,pointerYaw=0,pointerPitch=0
    let pointer={active:false,x:0,y:0,z:0,vx:0,vy:0,last:0,lastClientX:0,lastClientY:0}
    let waves:Shockwave[]=[]
    let vortices:Vortex[]=[]
    let kineticEnergy=.0,particleMotionActivity=.08,userInteractionActivity=0,pointerContactActivity=0,contactTurbulence=0,contactSignature=.5,contactMultiplicity=0,hasPreviousParticleFrame=false
    let passiveKineticBaseline=0

    const pointerPoint=(clientX:number,clientY:number)=>{
      const rect=artElement?.getBoundingClientRect()??host.getBoundingClientRect()
      const nx=((clientX-rect.left)/Math.max(1,rect.width))*2-1
      const ny=1-((clientY-rect.top)/Math.max(1,rect.height))*2
      const screen={x:nx*aspect*4.35/1.82,y:ny*4.35/1.82,z:0}
      return inverseRotate(screen,yaw,pitch)
    }
    const pointerPan=(clientX:number)=>{const rect=artElement?.getBoundingClientRect()??host.getBoundingClientRect();return clamp((((clientX-rect.left)/Math.max(1,rect.width))*2-1),-1,1)}
    const interactiveTarget=(target:EventTarget|null)=>target instanceof Element&&Boolean(target.closest("button,input,a,select,textarea,summary,[role='button'],[contenteditable='true'],.particle-horse-tuner"))

    const move=(event:PointerEvent)=>{
      if(interactiveTarget(event.target)){pointer.active=false;return}
      const now=performance.now()
      const p=pointerPoint(event.clientX,event.clientY)
      const dt=Math.max(8,Math.min(80,now-(pointer.last||now-16)))/1000
      const previous=pointer.last?pointerPoint(pointer.lastClientX,pointer.lastClientY):p
      pointer={active:true,x:p.x,y:p.y,z:p.z,vx:(p.x-previous.x)/dt,vy:(p.y-previous.y)/dt,last:now,lastClientX:event.clientX,lastClientY:event.clientY}
      const rect=artElement?.getBoundingClientRect()??host.getBoundingClientRect()
      pointerYaw=(((event.clientX-rect.left)/Math.max(1,rect.width))-.5)*.18
      pointerPitch=-(((event.clientY-rect.top)/Math.max(1,rect.height))-.5)*.12
    }
    const down=(event:PointerEvent)=>{
      if(event.button!==0||interactiveTarget(event.target))return
      event.preventDefault()
      move(event)
      audio.arm()
      const t=tuningRef.current
      const strength=(event.pointerType==="touch"?4.1:4.95)*t.waveStrength
      waves.push({origin:{x:pointer.x,y:pointer.y,z:pointer.z},started:performance.now(),strength})
      if(waves.length>4)waves.shift()
      audio.trigger("wave",pointerPan(event.clientX),Math.min(1,strength*.26))
    }
    const context=(event:MouseEvent)=>{
      if(interactiveTarget(event.target))return
      event.preventDefault()
      audio.arm()
      const t=tuningRef.current
      const p=pointerPoint(event.clientX,event.clientY)
      vortices.push({origin:p,started:performance.now(),duration:3400*t.vortexDuration,spin:(random()>.5?1:-1)*1.42*t.vortexStrength})
      if(vortices.length>2)vortices.shift()
      audio.trigger("vortex",pointerPan(event.clientX),.96)
    }
    const leave=()=>{pointer.active=false;pointerYaw=0;pointerPitch=0}

    eventSurface.addEventListener("pointermove",move,{passive:true})
    eventSurface.addEventListener("pointerdown",down)
    eventSurface.addEventListener("pointerleave",leave)
    eventSurface.addEventListener("contextmenu",context)

    const intersection=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);if(visible&&!frame)frame=requestAnimationFrame(render)},{threshold:.02})
    intersection.observe(host)
    const visibility=()=>{pageVisible=!document.hidden;if(pageVisible&&visible&&!frame)frame=requestAnimationFrame(render)}
    document.addEventListener("visibilitychange",visibility)

    const bind=(buffer:WebGLBuffer,attribute:number,size:number)=>{gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,size,gl.FLOAT,false,0,0)}

    const sampleTargets=(time:number)=>{
      if(!surface)return
      const orbitAngle=time*.00019
      const ca=Math.cos(orbitAngle),sa=Math.sin(orbitAngle)
      const horseScale=tuningRef.current.horseScale
      const horseOffsetX=tuningRef.current.horseOffsetX
      const pivotX=-.34,pivotY=.05,pivotZ=-.13
      for(let i=0;i<surface.count;i++){
        const o=i*3
        const p1x=(morphed[surface.triA[i]*3]*surface.ba[i])+(morphed[surface.triB[i]*3]*surface.bb[i])+(morphed[surface.triC[i]*3]*surface.bc[i])
        const p1y=(morphed[surface.triA[i]*3+1]*surface.ba[i])+(morphed[surface.triB[i]*3+1]*surface.bb[i])+(morphed[surface.triC[i]*3+1]*surface.bc[i])
        const p1z=(morphed[surface.triA[i]*3+2]*surface.ba[i])+(morphed[surface.triB[i]*3+2]*surface.bb[i])+(morphed[surface.triC[i]*3+2]*surface.bc[i])
        const p2x=(morphed[surface.triA2[i]*3]*surface.ba2[i])+(morphed[surface.triB2[i]*3]*surface.bb2[i])+(morphed[surface.triC2[i]*3]*surface.bc2[i])
        const p2y=(morphed[surface.triA2[i]*3+1]*surface.ba2[i])+(morphed[surface.triB2[i]*3+1]*surface.bb2[i])+(morphed[surface.triC2[i]*3+1]*surface.bc2[i])
        const p2z=(morphed[surface.triA2[i]*3+2]*surface.ba2[i])+(morphed[surface.triB2[i]*3+2]*surface.bb2[i])+(morphed[surface.triC2[i]*3+2]*surface.bc2[i])
        const seed=surface.seed[i]
        const swapPhase=.5+.5*Math.sin(time*.00063*(.75+seed*.65)+seed*11.7)
        const swapBlend=smoothstep(.76,1,swapPhase)*(seed > .18 ? .34 : 0)
        let tx=mix(p1x,p2x,swapBlend)
        let ty=mix(p1y,p2y,swapBlend)
        let tz=mix(p1z,p2z,swapBlend)
        const orbitLift=smoothstep(.76,1,.5+.5*Math.sin(time*.00021*(.75+seed*.55)+seed*19.4))*smoothstep(.58,1,seed)*.94
        const ox=surface.orbitBase[o],oy=surface.orbitBase[o+1],oz=surface.orbitBase[o+2]
        const rotX=ox*ca+oz*sa,rotZ=-ox*sa+oz*ca
        tx=mix(tx,rotX,orbitLift)
        ty=mix(ty,oy+.04*Math.sin(time*.0009+seed*TAU),orbitLift)
        tz=mix(tz,rotZ,orbitLift)
        const flutter=(.5+.5*Math.sin(time*.0016+seed*TAU*2)-.5)*.020
        tx+=flutter*(seed-.5)
        ty+=flutter*(.65-seed)
        tz+=flutter*Math.sin(seed*TAU)
        // Scale the complete horse formation around the model's authored pivot.
        // Doing this in simulation space (rather than only in the shader) keeps
        // attraction, pointer interaction, shockwaves, bloom and trails aligned.
        targets[o]=pivotX+(tx-pivotX)*horseScale+horseOffsetX
        targets[o+1]=pivotY+(ty-pivotY)*horseScale
        targets[o+2]=pivotZ+(tz-pivotZ)*horseScale
      }
    }

    const updateDust=(time:number,dt:number,energy:number)=>{
      const t=tuningRef.current
      const a=time*.00009,ca=Math.cos(a),sa=Math.sin(a),b=Math.sin(time*.00013)*.15,cb=Math.cos(b),sb=Math.sin(b),damp=Math.exp(-1.55*t.damping*dt),pointerHot=pointer.active&&time-pointer.last<220
      const bound=2.48+t.spill*3.0,bounce=.88
      for(let i=0;i<dustCount;i++){
        const o=i*3
        const x=dustBase[o],y=dustBase[o+1],z=dustBase[o+2]
        const tx=ca*x+sa*z,rz=-sa*x+ca*z,ty=cb*y-sb*rz,tz=sb*y+cb*rz
        let px=dustPositions[o],py=dustPositions[o+1],pz=dustPositions[o+2],vx=dustVelocities[o],vy=dustVelocities[o+1],vz=dustVelocities[o+2]
        const seed=dustSeeds[i]
        const wander=.16+.84*seed
        let ax=(tx-px)*(1.9+energy*1.35)*(.92-wander*.16),ay=(ty-py)*(1.9+energy*1.35)*(.92-wander*.16),az=(tz-pz)*(1.9+energy*1.35)*(.92-wander*.16)
        ax+=Math.sin(time*.0011+seed*29.0)*(.72+wander*.95)
        ay+=Math.cos(time*.0014+seed*17.0)*(.42+wander*.56)
        az+=Math.sin(time*.00125+seed*23.0)*(.72+wander*.95)
        if(pointerHot){
          const dx=px-pointer.x,dy=py-pointer.y,dz=pz-pointer.z,dist=Math.hypot(dx,dy,dz),range=1.08*t.pointerRadius
          if(dist<range&&dist>.0001){const f=Math.pow(1-dist/range,1.7),inv=1/dist,wind=clamp(Math.hypot(pointer.vx,pointer.vy)*.075,0,2.3);ax+=(dx*inv*(10+energy*3.5)*f+pointer.vx*(2.0+wind*4.6)*f)*t.pointerForce;ay+=(dy*inv*(10+energy*3.5)*f+pointer.vy*(2.0+wind*4.6)*f)*t.pointerForce;az+=(dz*inv*(8+energy*3.0)*f+(pointer.vx*.55-pointer.vy*.22)*(1.5+wind*3.0)*f)*t.pointerForce}
        }
        for(const wave of waves){
          const age=(time-wave.started)/1000,r=.045+age*5.05*t.waveRadius,dx=px-wave.origin.x,dy=py-wave.origin.y,dz=pz-wave.origin.z,dist=Math.hypot(dx,dy,dz)||.001,shell=Math.abs(dist-r)
          if(shell<.105){const edge=1-shell/.105,envelope=Math.exp(-age*2.15),f=edge*edge*envelope*wave.strength*27,inv=1/dist;ax+=dx*inv*f;ay+=dy*inv*f;az+=dz*inv*f}
        }
        for(const vortex of vortices){
          const age=(time-vortex.started)/vortex.duration
          if(age>=1)continue
          const dx=px-vortex.origin.x,dy=py-vortex.origin.y,dz=pz-vortex.origin.z,dist=Math.hypot(dx,dy,dz)
          if(dist<1.52&&dist>.02){const life=Math.pow(Math.max(0,1-age),.58),fall=Math.pow(1-dist/1.52,1.28)*life,planar=Math.hypot(dx,dy)||.001,spin=vortex.spin*fall*24;ax+=(-dy/planar)*spin-dx*fall*9.2;ay+=(dx/planar)*spin-dy*fall*9.2;az+=-dz*fall*6.8}
        }
        if(px>bound&&vx>0)vx*=-bounce;else if(px<-bound&&vx<0)vx*=-bounce
        if(py>bound&&vy>0)vy*=-bounce;else if(py<-bound&&vy<0)vy*=-bounce
        if(pz>bound&&vz>0)vz*=-bounce;else if(pz<-bound&&vz<0)vz*=-bounce
        vx=(vx+ax*dt)*damp;vy=(vy+ay*dt)*damp;vz=(vz+az*dt)*damp
        px+=vx*dt;py+=vy*dt;pz+=vz*dt
        if(px>bound){px=bound;vx*=-bounce}else if(px<-bound){px=-bound;vx*=-bounce}
        if(py>bound){py=bound;vy*=-bounce}else if(py<-bound){py=-bound;vy*=-bounce}
        if(pz>bound){pz=bound;vz*=-bounce}else if(pz<-bound){pz=-bound;vz*=-bounce}
        dustPositions[o]=px;dustPositions[o+1]=py;dustPositions[o+2]=pz
        dustVelocities[o]=vx;dustVelocities[o+1]=vy;dustVelocities[o+2]=vz
      }
    }

    const updatePhysics=(time:number,dt:number)=>{
      if(!surface)return 0
      const t=tuningRef.current
      // In-place compaction (swap-remove) — no per-frame array allocations.
      let compactWaves=0
      for(let i=0;i<waves.length;i++){if(time-waves[i].started<1100)waves[compactWaves++]=waves[i]}
      waves.length=compactWaves
      let compactVortices=0
      for(let i=0;i<vortices.length;i++){if(time-vortices[i].started<vortices[i].duration)vortices[compactVortices++]=vortices[i]}
      vortices.length=compactVortices
      const pointerHot=pointer.active&&time-pointer.last<220
      const damping=Math.exp(-(reduced.matches?2.0:2.45)*t.damping*dt)
      const magnet=(reduced.matches?9.8:8.6)*t.attraction
      let summedSpeed=0
      let displaced=0
      let directContactAccum=0
      let pointerContactAccum=0
      let reconvergenceAccum=0
      let neighbourImpactAccum=0
      let signatureAccum=0
      let signatureWeight=0
      let multiplicityAccum=0
      for(let i=0;i<surface.count;i++){
        const o=i*3
        let px=positions[o],py=positions[o+1],pz=positions[o+2],vx=velocities[o],vy=velocities[o+1],vz=velocities[o+2]
        const seed=surface.seed[i]
        const tx=targets[o],ty=targets[o+1],tz=targets[o+2]
        const dx=tx-px,dy=ty-py,dz=tz-pz
        const dist=Math.hypot(dx,dy,dz)||.0001
        const inv=1/dist
        displaced+=smoothstep(.12,1.25,dist)

        // Real surface attraction: acceleration points to each particle's own moving surface target.
        // Force is intentionally soft close to the surface and stronger only when far away.
        const pull=magnet*(.18+Math.min(1.45,dist)*.74)
        let ax=dx*inv*pull,ay=dy*inv*pull-.008,az=dz*inv*pull

        // Thermal / magnetic micro-motion around the surface; particles never look welded to it.
        const near=1-smoothstep(.03,.32,dist)
        const jitter=(.44+near*.96)*t.jitter
        ax+=(Math.sin(time*.0018+seed*23.7)+Math.sin(time*.0032+seed*7.1)*.43)*jitter
        ay+=(Math.cos(time*.00155+seed*15.2)+Math.sin(time*.0026+seed*5.3)*.38)*jitter*.58
        az+=(Math.sin(time*.0021+seed*12.4)+Math.cos(time*.0035+seed*8.7)*.40)*jitter*.80

        // Very weak only-when-near neighbour response: cohesion at range, repulsion when crowded.
        const li=surface.link[i]%surface.count
        if(li!==i){
          const lo=li*3,lx=positions[lo]-px,ly=positions[lo+1]-py,lz=positions[lo+2]-pz,ld=Math.hypot(lx,ly,lz)||.001
          if(ld<.16){
            const rest=.055+seed*.035
            const nf=clamp((ld-rest)*1.5,-.12,.12)
            ax+=lx/ld*nf;ay+=ly/ld*nf;az+=lz/ld*nf
            const rvx=velocities[lo]-vx,rvy=velocities[lo+1]-vy,rvz=velocities[lo+2]-vz
            const closing=Math.max(0,-(lx*rvx+ly*rvy+lz*rvz)/ld-.10)
            const proximity=1-smoothstep(.035,.16,ld)
            const impactWeight=clamp(closing*proximity*.16,0,1)
            neighbourImpactAccum+=impactWeight
            if(impactWeight>.0001){const sig=fract(seed*11.73+surface.seed[li]*7.19+surface.group[i]*.037);signatureAccum+=sig*impactWeight;signatureWeight+=impactWeight;multiplicityAccum+=impactWeight*2.2}
            if(ld<.028){const repel=(.028-ld)*15;ax-=lx/ld*repel;ay-=ly/ld*repel;az-=lz/ld*repel}
          }
        }

        // Pointer is a moving physical probe: momentum and radial pressure are transferred locally.
        if(pointerHot){
          const qx=px-pointer.x,qy=py-pointer.y,qz=pz-pointer.z,qd=Math.hypot(qx,qy,qz),range=.94*t.pointerRadius
          if(qd<range&&qd>.0001){
            const f=Math.pow(1-qd/range,1.85),qinv=1/qd
            const wind=clamp(Math.hypot(pointer.vx,pointer.vy)*.06,0,1.9)
            ax+=(qx*qinv*19*f+pointer.vx*2.1*f+pointer.vx*7.5*f*wind)*t.pointerForce
            ay+=(qy*qinv*19*f+pointer.vy*2.1*f+pointer.vy*7.5*f*wind)*t.pointerForce
            az+=(qz*qinv*13*f+(pointer.vx*.65-pointer.vy*.22)*3.2*f*wind)*t.pointerForce
            const contactWeight=f*(.35+wind*1.15)
            directContactAccum+=contactWeight
            pointerContactAccum+=contactWeight
            const sig=fract(seed*13.37+surface.group[i]*.071+pointer.x*.19+pointer.y*.11)
            signatureAccum+=sig*contactWeight;signatureWeight+=contactWeight;multiplicityAccum+=f*(.20+wind*.70)
          }
        }
        for(const wave of waves){
          const age=(time-wave.started)/1000,r=.045+age*4.35*t.waveRadius,qx=px-wave.origin.x,qy=py-wave.origin.y,qz=pz-wave.origin.z,qd=Math.hypot(qx,qy,qz)||.001,shell=Math.abs(qd-r)
          if(shell<.12){const edge=1-shell/.12,envelope=Math.exp(-age*1.95),f=edge*edge*envelope*wave.strength*24,qinv=1/qd;ax+=qx*qinv*f;ay+=qy*qinv*f;az+=qz*qinv*f;const contactWeight=edge*envelope*wave.strength*.82;directContactAccum+=contactWeight;const sig=fract(seed*17.11+surface.group[i]*.053+wave.origin.x*.13);signatureAccum+=sig*contactWeight;signatureWeight+=contactWeight;multiplicityAccum+=edge*envelope*.62}
        }
        for(const vortex of vortices){
          const age=(time-vortex.started)/vortex.duration
          if(age>=1)continue
          const qx=px-vortex.origin.x,qy=py-vortex.origin.y,qz=pz-vortex.origin.z,qd=Math.hypot(qx,qy,qz)
          const vortexRange=1.42*clamp(.82+t.vortexStrength*.18,.75,1.35)
          if(qd<vortexRange&&qd>.012){const life=Math.pow(Math.max(0,1-age),.56),fall=Math.pow(1-qd/vortexRange,1.28)*life,planar=Math.hypot(qx,qy)||.001,spin=vortex.spin*fall*31;ax+=(-qy/planar)*spin-qx*fall*12*t.vortexStrength;ay+=(qx/planar)*spin-qy*fall*12*t.vortexStrength;az+=-qz*fall*8.5*t.vortexStrength;const contactWeight=fall*.72;directContactAccum+=contactWeight;const sig=fract(seed*19.91+surface.group[i]*.043+vortex.origin.y*.17);signatureAccum+=sig*contactWeight;signatureWeight+=contactWeight;multiplicityAccum+=fall*.54}
        }

        // Soft cube walls: bound the simulation without any force toward the horse's center.
        const bound=2.18+t.spill*3.2,wall=24
        if(px>bound)ax-=(px-bound)*wall;else if(px<-bound)ax-=(px+bound)*wall
        if(py>bound)ay-=(py-bound)*wall;else if(py<-bound)ay-=(py+bound)*wall
        if(pz>bound)az-=(pz-bound)*wall;else if(pz<-bound)az-=(pz+bound)*wall

        vx=(vx+ax*dt)*damping;vy=(vy+ay*dt)*damping;vz=(vz+az*dt)*damping
        // Acoustic return energy: only count meaningful displacement that is travelling back
        // toward its own surface target. This is what stays energetic after a shockwave.
        const returnSpeed=Math.max(0,(vx*dx+vy*dy+vz*dz)*inv-.16)
        const returnGate=smoothstep(.065,.62,dist)
        const returnWeight=clamp(returnSpeed*returnGate*.14,0,1)
        reconvergenceAccum+=returnWeight
        if(returnWeight>.0001){const sig=fract(seed*23.47+surface.group[i]*.061+dist*.17);signatureAccum+=sig*returnWeight;signatureWeight+=returnWeight;multiplicityAccum+=returnWeight*1.45}
        px+=vx*dt;py+=vy*dt;pz+=vz*dt
        positions[o]=px;positions[o+1]=py;positions[o+2]=pz
        velocities[o]=vx;velocities[o+1]=vy;velocities[o+2]=vz
        summedSpeed+=Math.hypot(vx,vy,vz)
      }
      const normalizedKinetic=surface.count?summedSpeed/surface.count:0
      const displacement=surface.count?displaced/surface.count:0
      const directContact=surface.count?clamp((directContactAccum/surface.count)*18,0,1):0
      const pointerContact=surface.count?clamp((pointerContactAccum/surface.count)*18,0,1):0
      const reconvergence=surface.count?clamp((reconvergenceAccum/surface.count)*24,0,1):0
      const neighbourImpact=surface.count?clamp((neighbourImpactAccum/surface.count)*68,0,1):0
      // Keep a visual/general turbulence meter, but expose separate acoustic meters below.
      const measuredContact=clamp(directContact*.58+reconvergence*.88+neighbourImpact*1.10,0,1)
      contactTurbulence+=(measuredContact-contactTurbulence)*(measuredContact>contactTurbulence?.30:.042)
      // Motion meter deliberately includes ordinary animated travel instead of subtracting a
      // baseline. This is the physical source for passive chimes and the continuous air bed.
      const motionMeasured=clamp(smoothstep(.022,.68,normalizedKinetic)*.48+displacement*.16+reconvergence*.54+neighbourImpact*.78+directContact*.16,0,1)
      particleMotionActivity+=(motionMeasured-particleMotionActivity)*(motionMeasured>particleMotionActivity?.22:.035)

      // Track the horse's natural kinetic baseline only while it is not being user-disturbed.
      // A shockwave therefore creates a measurable kinetic excess that remains attributable to
      // the user while particles fly back, reconverge and collide, then disappears naturally
      // when their speed/distance/contact statistics return to the passive baseline.
      const explicitUserForce=pointerHot||waves.length>0||vortices.length>0||directContact>.001
      if(passiveKineticBaseline<=0)passiveKineticBaseline=normalizedKinetic
      const baselineRate=explicitUserForce||userInteractionActivity>.02?.0015:.018
      passiveKineticBaseline+=(normalizedKinetic-passiveKineticBaseline)*baselineRate
      const kineticExcess=Math.max(0,normalizedKinetic-passiveKineticBaseline*1.08-.006)
      const kineticRecovery=clamp(kineticExcess*2.4,0,1)
      const recoveryPhysics=clamp(kineticRecovery*.72+reconvergence*.88+neighbourImpact*.92+displacement*.22,0,1)
      const causalTarget=explicitUserForce
        ? clamp(Math.max(directContact,recoveryPhysics,waves.length?.18:0,vortices.length?.16:0),0,1)
        : userInteractionActivity>.006?recoveryPhysics:0
      const causalRate=causalTarget>userInteractionActivity?.38:.16
      userInteractionActivity+=(causalTarget-userInteractionActivity)*causalRate
      if(!explicitUserForce&&recoveryPhysics<.006&&userInteractionActivity<.004)userInteractionActivity=0
      pointerContactActivity+=(pointerContact-pointerContactActivity)*(pointerContact>pointerContactActivity?.46:.11)
      const rawSignature=signatureWeight>.0001?fract(signatureAccum/signatureWeight):contactSignature
      // Keep some continuity so the melody follows a moving collision region, but do not
      // smooth so heavily that a mouse sweep freezes on one pitch identity.
      const signatureRate=pointerHot?.42:.24
      contactSignature=fract(contactSignature+(rawSignature-contactSignature)*signatureRate+1)
      const normalizedMultiplicity=surface.count?clamp((multiplicityAccum/surface.count)*34,0,1):0
      contactMultiplicity+=(normalizedMultiplicity-contactMultiplicity)*(normalizedMultiplicity>contactMultiplicity?.34:.075)
      return normalizedKinetic*.9+displacement*.28
    }

    const draw=(time:number,dt:number)=>{
      if(!surface)return
      const dark=document.documentElement.dataset.mode!=="light"
      gl.bindFramebuffer(gl.FRAMEBUFFER,null)
      gl.viewport(0,0,canvas.width,canvas.height)
      gl.enable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.depthMask(false)
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)
      gl.useProgram(program)
      gl.uniform1f(uniforms.yaw,yaw)
      gl.uniform1f(uniforms.pitch,pitch)
      gl.uniform1f(uniforms.aspect,aspect)
      const sceneScale=aspect < .72 ? (mobile ? .88 : .9) : aspect < .95 ? (mobile ? 1.02 : 1.04) : aspect > 1.55 ? (mobile ? 1.28 : 1.4) : (mobile ? 1.12 : 1.22)
      const dprComp=mobile?clamp(.98-(dpr-1)*.32,.42,.84):1
      const particleScale=mobile ? ((aspect < .72 ? .34 : aspect < .95 ? .40 : .48)*dprComp) : (aspect > 1.55 ? 1.06 : 1.0)
      const t=tuningRef.current
      gl.uniform1f(uniforms.sceneScale,sceneScale)
      gl.uniform2f(uniforms.stageScale,stageScaleX,stageScaleY)
      gl.uniform2f(uniforms.stageOffset,stageOffsetX,stageOffsetY)
      gl.uniform1f(uniforms.sizeMin,t.particleMin)
      gl.uniform1f(uniforms.sizeMedian,t.particleMedian)
      gl.uniform1f(uniforms.sizeMax,t.particleMax)
      gl.uniform1f(uniforms.smallBrightness,t.smallBrightness)
      gl.uniform1f(uniforms.largeBrightness,t.largeBrightness)
      gl.uniform1f(uniforms.brightnessRandomness,t.brightnessRandomness)
      gl.uniform1f(uniforms.winkDepth,t.winkDepth)
      gl.uniform1f(uniforms.winkSpeed,t.winkSpeed)
      gl.uniform1f(uniforms.winkSpeedRandomness,t.winkSpeedRandomness)
      gl.uniform1f(uniforms.winkSizeBias,t.winkSizeBias)
      gl.uniform1f(uniforms.overallBrightness,t.overallBrightness)
      gl.uniform1f(uniforms.saturation,t.saturation)
      gl.uniform1f(uniforms.palette,t.palette)
      gl.uniform1f(uniforms.time,time*.001)
      gl.uniform1f(uniforms.dark,dark?1:0)
      gl.uniform1f(uniforms.fineBloomThreshold,t.fineBloomThreshold)
      gl.blendFunc(gl.SRC_ALPHA,dark?gl.ONE:gl.ONE_MINUS_SRC_ALPHA)

      updateDust(time,dt,kineticEnergy)
      gl.bindBuffer(gl.ARRAY_BUFFER,dustPositionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER,dustPositions,gl.DYNAMIC_DRAW)
      bind(dustPositionBuffer,posLoc,3)
      bind(dustSeedBuffer,seedLoc,1)
      bind(dustScaleBuffer,scaleLoc,1)
      // The lite tier renders a single crisp core pass: halo passes, the
      // temporal trail and the bloom post-process are skipped entirely.
      const liteRender=qualityTier==="lite"
      gl.uniform1f(uniforms.renderMode,0)
      gl.uniform1f(uniforms.opacity,dark ? .42 : .34)
      gl.uniform1f(uniforms.point,(dark ? 1.18 : 1.62)*dpr*particleScale*t.dustSize)
      gl.uniform1f(uniforms.depth,.0008)
      gl.drawArrays(gl.POINTS,0,Math.floor(dustCount*drawRatio))

      const count=Math.floor(surface.count*drawRatio)
      const effectCount=Math.floor(count*(mobile?.72:.90))
      bind(seedBuffer,seedLoc,1)
      bind(scaleBuffer,scaleLoc,1)
      gl.uniform1f(uniforms.depth,0)

      // Cheap temporal trail: the dynamic position buffer still contains the previous
      // particle frame until this frame uploads its new positions. Reuse that GPU data
      // directly instead of allocating a history texture or running a full-screen blur.
      if(hasPreviousParticleFrame&&!reduced.matches&&!liteRender&&t.motionBlurStrength>.004&&effectCount>0){
        bind(positionBuffer,posLoc,3)
        const motionEnergy=clamp(.42+kineticEnergy*.30+contactTurbulence*.55,.35,1)
        gl.uniform1f(uniforms.renderMode,2)
        gl.uniform1f(uniforms.opacity,t.motionBlurStrength*(dark?.46:.34)*motionEnergy)
        gl.uniform1f(uniforms.point,(dark?2.72:3.02)*dpr*particleScale*t.coreSize*t.motionBlurSpread)
        gl.drawArrays(gl.POINTS,0,effectCount)
      }

      gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer)
      gl.bufferData(gl.ARRAY_BUFFER,positions,gl.DYNAMIC_DRAW)
      bind(positionBuffer,posLoc,3)
      hasPreviousParticleFrame=true

      // Optical bloom is a real separate image-space layer: extract only emissive
      // particles above the live threshold into a tiny offscreen buffer, blur it with
      // two 5-tap separable Gaussian passes, then composite after the crisp particles.
      // The 24-30% linear resolution keeps the effect substantially cheaper than a
      // full-resolution HDR/post stack while still producing a continuous light halo.
      let bloomCompositable=false
      if(bloomReady&&bloomAllowed&&!liteRender&&bloomProgram&&bloomUniforms&&bloomQuadBuffer&&bloomTextureA&&bloomTextureB&&bloomFramebufferA&&bloomFramebufferB&&t.fineBloomStrength>.004&&effectCount>0){
        gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferA)
        gl.viewport(0,0,bloomWidth,bloomHeight)
        gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE)
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(program)
        bind(positionBuffer,posLoc,3);bind(seedBuffer,seedLoc,1);bind(scaleBuffer,scaleLoc,1)
        gl.uniform1f(uniforms.renderMode,1)
        gl.uniform1f(uniforms.opacity,1)
        const bloomSourcePoint=Math.max(1.35,(dark?4.25:4.70)*dpr*particleScale*t.coreSize*bloomScale)
        gl.uniform1f(uniforms.point,bloomSourcePoint)
        gl.drawArrays(gl.POINTS,0,effectCount)

        gl.disable(gl.BLEND)
        gl.useProgram(bloomProgram)
        gl.bindBuffer(gl.ARRAY_BUFFER,bloomQuadBuffer);gl.enableVertexAttribArray(bloomPosLoc);gl.vertexAttribPointer(bloomPosLoc,2,gl.FLOAT,false,0,0)
        gl.activeTexture(gl.TEXTURE0);gl.uniform1i(bloomUniforms.texture,0);gl.uniform1f(bloomUniforms.composite,0);gl.uniform1f(bloomUniforms.intensity,1)
        const blurRadius=.48+t.fineBloomRadius*.76
        gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferB);gl.bindTexture(gl.TEXTURE_2D,bloomTextureA);gl.uniform2f(bloomUniforms.direction,blurRadius/Math.max(1,bloomWidth),0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4)
        gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferA);gl.bindTexture(gl.TEXTURE_2D,bloomTextureB);gl.uniform2f(bloomUniforms.direction,0,blurRadius/Math.max(1,bloomHeight));gl.drawArrays(gl.TRIANGLE_STRIP,0,4)
        bloomCompositable=true

        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height)
        gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,dark?gl.ONE:gl.ONE_MINUS_SRC_ALPHA)
        bind(positionBuffer,posLoc,3);bind(seedBuffer,seedLoc,1);bind(scaleBuffer,scaleLoc,1)
      }

      gl.uniform1f(uniforms.renderMode,0)
      gl.uniform1f(uniforms.opacity,dark ? .20 : .18)
      gl.uniform1f(uniforms.point,(dark?4.28:4.15)*dpr*particleScale*t.coreSize)
      gl.drawArrays(gl.POINTS,0,count)
      if(!liteRender){
        if(dark){
          gl.uniform1f(uniforms.opacity,.066)
          gl.uniform1f(uniforms.point,5.9*dpr*particleScale*t.coreSize)
          gl.drawArrays(gl.POINTS,0,count)
        } else {
          gl.uniform1f(uniforms.opacity,.082)
          gl.uniform1f(uniforms.point,5.0*dpr*particleScale*t.coreSize)
          gl.drawArrays(gl.POINTS,0,count)
        }
      }
      gl.uniform1f(uniforms.opacity,dark ? .92 : .98)
      gl.uniform1f(uniforms.point,(dark?1.64:2.22)*dpr*particleScale*t.coreSize)
      gl.drawArrays(gl.POINTS,0,count)

      if(bloomCompositable&&bloomProgram&&bloomUniforms&&bloomQuadBuffer&&bloomTextureA&&bloomTextureB&&bloomFramebufferA&&bloomFramebufferB){
        // Artistic dual-scale bloom. First composite a concentrated optical halo,
        // then blur that halo again at low resolution and add a softer wide lobe.
        // This stays cheap (two extra low-res blur draws + one simple composite)
        // while reading much more like emitted light than particle brightness.
        gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE)
        gl.useProgram(bloomProgram)
        gl.bindBuffer(gl.ARRAY_BUFFER,bloomQuadBuffer);gl.enableVertexAttribArray(bloomPosLoc);gl.vertexAttribPointer(bloomPosLoc,2,gl.FLOAT,false,0,0)
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,bloomTextureA)
        gl.uniform1i(bloomUniforms.texture,0);gl.uniform2f(bloomUniforms.direction,0,0);gl.uniform1f(bloomUniforms.composite,1)
        gl.uniform1f(bloomUniforms.intensity,t.fineBloomStrength*(dark?.56:.44))
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4)

        const wideRadius=1.10+t.fineBloomRadius*1.28
        gl.disable(gl.BLEND);gl.uniform1f(bloomUniforms.composite,0);gl.uniform1f(bloomUniforms.intensity,1)
        gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferB);gl.viewport(0,0,bloomWidth,bloomHeight);gl.bindTexture(gl.TEXTURE_2D,bloomTextureA);gl.uniform2f(bloomUniforms.direction,wideRadius/Math.max(1,bloomWidth),0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4)
        gl.bindFramebuffer(gl.FRAMEBUFFER,bloomFramebufferA);gl.bindTexture(gl.TEXTURE_2D,bloomTextureB);gl.uniform2f(bloomUniforms.direction,0,wideRadius/Math.max(1,bloomHeight));gl.drawArrays(gl.TRIANGLE_STRIP,0,4)

        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE)
        gl.bindTexture(gl.TEXTURE_2D,bloomTextureA);gl.uniform2f(bloomUniforms.direction,0,0);gl.uniform1f(bloomUniforms.composite,1)
        gl.uniform1f(bloomUniforms.intensity,t.fineBloomStrength*(dark?.34:.27))
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4)
      }
    }

    const render=(now:number)=>{
      frame=0
      if(disposed||!visible||!pageVisible)return
      const dt=Math.min(.033,Math.max(.001,(now-lastFrame)/1000))
      lastFrame=now
      if(modelReady&&surface){
        const pointerStale=now-pointer.last>2500
        const idle=pointerStale&&!pointer.active
        if(idle&&drawRatio>=1){
          idleCapFrames=Math.min(idleCapFrames+1,600)
        } else idleCapFrames=0
        // 33.4ms floor while idle (≈30fps); full rate the moment anything moves.
        if(idleCapFrames>12&&now-lastDrawTime<33.4){frame=requestAnimationFrame(render);return}
        const animationTime=reduced.matches?0.37:(now*.001)
        // Morph cache: weights only move with animationTime. Sub-5ms steps are
        // invisible even at 60fps, and reduced-motion is a single evaluation.
        if(Math.abs(animationTime-lastMorphTime)>.005){
          sampleWeights(animation,defaults,animationTime,weights)
          morphVertices(base,morphs,weights,morphed)
          lastMorphTime=animationTime
        }
        sampleTargets(now)
        kineticEnergy=updatePhysics(now,dt)
        const manualYaw=cameraOrbitRef.current*1.15
        const autoYaw=reduced.matches?0:(Math.sin(now*.00018)*.05)
        const cinematicLift=reduced.matches?0:(Math.cos(now*.00024)*.015)
        yaw+=((manualYaw+autoYaw+pointerYaw)-yaw)*Math.min(1,dt*2.35)
        pitch+=((.08+cinematicLift+pointerPitch)-pitch)*Math.min(1,dt*2.7)
        const pointerHot=pointer.active&&now-pointer.last<220
        const pointerSpeed=pointerHot?clamp(Math.hypot(pointer.vx,pointer.vy)*.060,0,1):0
        const pointerPosition=pointerHot?pointerPan(pointer.lastClientX):0
        const orbitLevel=clamp(kineticEnergy*.22+contactTurbulence*.18+vortices.length*.18,0,1)
        lastDrawTime=now
        draw(now,dt)
        audio.step(clamp(particleMotionActivity,0,1),clamp(userInteractionActivity,0,1),clamp(orbitLevel,0,1),contactSignature,contactMultiplicity,clamp(pointerContactActivity,0,1),pointerPosition,pointerSpeed)
        if(dt>.026)slowFrames++
        else {slowFrames=Math.max(0,slowFrames-2);fastFrames++}
        // R32 hysteresis ladder: degrade fast under sustained pressure, then
        // recover gradually so a single stall never permanently halves quality.
        if(slowFrames>40&&drawRatio>.72){drawRatio=.70;slowFrames=0;fastFrames=0}
        else if(slowFrames>90&&drawRatio>.55){drawRatio=.55;bloomAllowed=false;slowFrames=0;fastFrames=0}
        if(drawRatio<1&&fastFrames>600){drawRatio=Math.min(1,drawRatio+.15);bloomAllowed=qualityTier!=="lite";fastFrames=0}
      }
      frame=requestAnimationFrame(render)
    }

    void fetchHorseModel(abort.signal).then(model=>{
      if(disposed)return
      const transformed=buildTransforms(model)
      base=transformed.base
      morphs=transformed.morphs
      morphed=new Float32Array(base.length)
      weights=new Float32Array(model.morphs.length)
      animation=model.animation
      defaults=model.weightsDefault
      surface=buildSurface(base,model.indices,particleCount,groupCount)
      morphed.set(base)
      sampleTargets(performance.now())
      for(let i=0;i<surface.count;i++){
        const o=i*3
        const scatter=.08+.02*surface.seed[i]
        positions[o]=targets[o]+(random()-.5)*scatter
        positions[o+1]=targets[o+1]+(random()-.5)*scatter
        positions[o+2]=targets[o+2]+(random()-.5)*scatter
      }
      gl.bindBuffer(gl.ARRAY_BUFFER,seedBuffer)
      gl.bufferData(gl.ARRAY_BUFFER,surface.seed,gl.STATIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER,scaleBuffer)
      gl.bufferData(gl.ARRAY_BUFFER,surface.scale,gl.STATIC_DRAW)
      modelReady=true
      setStatus("ready")
      if(!frame&&visible&&pageVisible){lastFrame=performance.now();frame=requestAnimationFrame(render)}
    }).catch(error=>{
      if(!disposed&&!abort.signal.aborted){
        console.error("[ParticleHorse] animated horse model load failed",error)
        setFailureKind("model")
        setStatus("error")
      }
    })

    frame=requestAnimationFrame(render)
    return ()=>{
      disposed=true
      abort.abort()
      audio.idle()
      if(frame)cancelAnimationFrame(frame)
      if(syncStageRegistrationRef.current===resize)syncStageRegistrationRef.current=null
      resizeObserver.disconnect()
      intersection.disconnect()
      document.removeEventListener("visibilitychange",visibility)
      eventSurface.removeEventListener("pointermove",move)
      eventSurface.removeEventListener("pointerdown",down)
      eventSurface.removeEventListener("pointerleave",leave)
      eventSurface.removeEventListener("contextmenu",context)
      if(audioRef.current===audio)audioRef.current=null
      gl.deleteBuffer(positionBuffer)
      gl.deleteBuffer(seedBuffer)
      gl.deleteBuffer(scaleBuffer)
      gl.deleteBuffer(dustPositionBuffer)
      gl.deleteBuffer(dustSeedBuffer)
      gl.deleteBuffer(dustScaleBuffer)
      if(bloomQuadBuffer)gl.deleteBuffer(bloomQuadBuffer)
      if(bloomTextureA)gl.deleteTexture(bloomTextureA)
      if(bloomTextureB)gl.deleteTexture(bloomTextureB)
      if(bloomFramebufferA)gl.deleteFramebuffer(bloomFramebufferA)
      if(bloomFramebufferB)gl.deleteFramebuffer(bloomFramebufferB)
      if(bloomProgram)gl.deleteProgram(bloomProgram)
      gl.deleteProgram(program)
    }
  },[heroTarget])

  const loading=uiText(locale, "FORMING…", "در حال شکل‌گیری…")
  const failure=failureKind==="model"
    ? (uiText(locale, "3D MODEL LOAD FAILED", "بارگذاری مدل سه‌بعدی ناموفق بود"))
    : failureKind==="shader"
      ? (uiText(locale, "WEBGL SHADER INIT FAILED", "راه‌اندازی افکت WebGL ناموفق بود"))
      : (uiText(locale, "WEBGL UNAVAILABLE", "WebGL در دسترس نیست"))
  const hint=uiText(locale, "MOVE: DISTURB · LEFT: SHOCKWAVE · RIGHT: VORTEX · AUDIO AWAKES ON FIRST GESTURE", "حرکت نشانگر: اختلال · کلیک چپ: موج · کلیک راست: گرداب · صدا با نخستین تعامل بیدار می‌شود")

  const visualStyle={
    "--ph-bloom-near":`${18*tuning.bloomRadius}px`,
    "--ph-bloom-mid":`${38*tuning.bloomRadius}px`,
    "--ph-bloom-far":`${68*tuning.bloomRadius}px`,
    "--ph-bloom-near-alpha":`${clamp(24*tuning.bloomStrength,1,42)}%`,
    "--ph-bloom-mid-alpha":`${clamp(16*tuning.bloomStrength,1,34)}%`,
    "--ph-bloom-far-alpha":`${clamp(8*tuning.bloomStrength,.5,20)}%`,
    "--ph-light-near-alpha":String(clamp(.14*tuning.bloomStrength,.01,.30)),
    "--ph-light-mid-alpha":`${clamp(10*tuning.bloomStrength,.5,24)}%`,
    "--ph-light-far-alpha":String(clamp(.055*tuning.bloomStrength,.005,.16)),
    "--ph-aura-opacity":String(clamp(.96*tuning.auraStrength,.08,1.35)),
    "--ph-aura-blur":`${34*tuning.bloomRadius}px`,
    "--ph-light-aura-opacity":String(clamp(.82*tuning.auraStrength,.06,1.18)),
    "--ph-light-aura-blur":`${32*tuning.bloomRadius}px`,
    "--ph-mobile-near-alpha":`${clamp(22*tuning.bloomStrength,1,38)}%`,
    "--ph-mobile-mid-alpha":`${clamp(14*tuning.bloomStrength,1,30)}%`,
    "--ph-mobile-far-alpha":`${clamp(7*tuning.bloomStrength,.5,18)}%`,
    "--ph-mobile-aura-blur":`${28*tuning.bloomRadius}px`,
  } as React.CSSProperties&Record<`--${string}`,string>
  const overlay=heroTarget?createPortal(<div ref={hostRef} className="particle-horse-splash particle-horse-hero-field" role="img" aria-label={uiText(locale, "Interactive 3D running horse formed from dynamic physical particles with responsive sound", "اسب سه‌بعدی در حال دویدن، ساخته‌شده از ذرات تعاملی با فیزیک پویا و صدا")} data-status={status} data-locale={locale} dir={(isUiRtl(locale) ? "rtl" : "ltr")} style={visualStyle}>
    <canvas ref={canvasRef} aria-hidden="true"/>
    <div className="particle-horse-aura" aria-hidden="true"/>
    <div className="particle-horse-status" aria-live="polite">{status==="loading"?loading:status==="error"?failure:""}</div>
    {status==="ready"&&<div className="particle-horse-hint" aria-hidden="true">{hint}</div>}
    {status==="ready"&&<button type="button" className="particle-horse-tune-button" aria-expanded={tunerOpen} aria-label={uiText(locale, "Particle and audio tuning", "تنظیمات ذرات و صدا")} title={uiText(locale, "Particle tuning lab", "آزمایشگاه تنظیم ذرات")} onClick={()=>setTunerOpen(open=>!open)}><i/><i/><i/></button>}
    {tunerOpen&&<ParticleHorseTuner locale={locale} tuning={tuning} onChange={updateTuning} onPreset={applyPreset} onReset={resetTuning} onClose={()=>setTunerOpen(false)}/>}  
  </div>,heroTarget):null
  return <><div ref={anchorRef} className="particle-horse-anchor" aria-hidden="true"/>{overlay}</>
}
