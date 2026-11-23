/**
 * Assistant sound cues (R56). Small, calm, messenger-style feedback sounds for
 * send / receive, synthesized with the Web Audio API — no audio files to fetch,
 * no third-party requests, instant playback, and they automatically respect the
 * browser autoplay policy (the first send click unlocks the AudioContext).
 *
 * The user-facing preference (muted / unmuted) persists in localStorage and is
 * surfaced as a speaker toggle in the assistant control strip.
 */

const PREF_KEY = "horse-db-ai-sound-muted";

let ctx: AudioContext | null = null;
let unlocked = false;

function readMuted(): boolean {
  try { return localStorage.getItem(PREF_KEY) === "1"; } catch { return false; }
}

export function assistantSoundMuted(): boolean { return readMuted(); }

export function setAssistantSoundMuted(muted: boolean): void {
  try { localStorage.setItem(PREF_KEY, muted ? "1" : "0"); } catch { /* optional */ }
}

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** Must be called from a user gesture (click) once to satisfy autoplay policy. */
export function unlockAssistantSound(): void {
  const context = audioContext();
  if (!context) return;
  if (unlocked && context.state !== "suspended") return;
  void context.resume().then(() => { unlocked = true; }).catch(() => { /* stays silent */ });
}

interface ToneOptions {
  freq: number;
  start: number;      // seconds from now
  duration: number;   // seconds
  type?: OscillatorType;
  gain?: number;
  glideTo?: number;   // optional frequency glide target
}

function tone(context: AudioContext, options: ToneOptions): void {
  const osc = context.createOscillator();
  const amp = context.createGain();
  const t0 = context.currentTime + options.start;
  const peak = options.gain ?? 0.075;
  osc.type = options.type ?? "sine";
  osc.frequency.setValueAtTime(options.freq, t0);
  if (options.glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(options.glideTo, t0 + options.duration);
  // Fast attack, musical exponential decay — a soft "blip", not a beep.
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + options.duration);
  osc.connect(amp).connect(context.destination);
  osc.start(t0);
  osc.stop(t0 + options.duration + 0.02);
}

/** Outgoing-message cue: a short, airy "pop" with a gentle downward flick. */
export function playAssistantSendCue(): void {
  if (readMuted()) return;
  const context = audioContext();
  if (!context || context.state === "suspended") return;
  tone(context, { freq: 660, start: 0, duration: 0.09, type: "sine", gain: 0.055, glideTo: 440 });
  tone(context, { freq: 1320, start: 0.004, duration: 0.05, type: "triangle", gain: 0.014 });
}

/** Incoming-answer cue: a calm two-note "da-din" confirmation. */
export function playAssistantReceiveCue(): void {
  if (readMuted()) return;
  const context = audioContext();
  if (!context || context.state === "suspended") return;
  tone(context, { freq: 523.25, start: 0, duration: 0.10, type: "sine", gain: 0.05 });   // C5
  tone(context, { freq: 783.99, start: 0.09, duration: 0.16, type: "sine", gain: 0.045 }); // G5
  tone(context, { freq: 1567.98, start: 0.095, duration: 0.09, type: "triangle", gain: 0.012 });
}
