// ============================================================================
// sfx.ts — tiny synthesized sound effects for Market Harvest
// ----------------------------------------------------------------------------
// A market-quality kids' game needs audio feedback on every interaction. These
// little jingles are synthesized with the WebAudio API (simple oscillators with
// volume envelopes), so they need no sound files and work in both the browser
// and inside a WebXR session (WebAudio keeps playing in XR).
//
// The AudioContext can only start after the player's first interaction
// (browser autoplay rules), so we create it lazily on the first play call —
// which always happens inside a click/select handler anyway.
// ============================================================================

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext ||
        (window as any).webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null; // no audio support — every play call becomes a silent no-op
  }
}

/**
 * Play one synthesized note.
 *   freq      - pitch in Hz
 *   duration  - seconds
 *   type      - oscillator waveform ("sine" is soft, "square" is chiptune-y)
 *   volume    - 0..1 peak volume
 *   when      - seconds from now to start (lets us build little melodies)
 *   slideTo   - optional pitch to glide toward over the note's length
 */
function note(
  freq: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.18,
  when = 0,
  slideTo?: number,
) {
  const ctx = getCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) {
    osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  }
  // Quick attack, smooth exponential release — no clicks or pops.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Soft UI click/tap. */
export function sfxClick() {
  note(660, 0.07, "sine", 0.12);
  note(990, 0.05, "sine", 0.06, 0.02);
}

/** A seed going into the soil — a friendly low "plop". */
export function sfxPlant() {
  note(380, 0.12, "sine", 0.2, 0, 180);
  note(720, 0.06, "triangle", 0.08, 0.05);
}

/** Coins! An ascending sparkle for earnings and rewards. */
export function sfxCoin() {
  note(880, 0.09, "square", 0.07);
  note(1175, 0.12, "square", 0.07, 0.07);
}

/** Something went down (a price drop, a penalty). Gentle, not scary. */
export function sfxDown() {
  note(420, 0.18, "triangle", 0.12, 0, 260);
}

/** A short rising "whoosh-ding" for phase changes / season banners. */
export function sfxSeason() {
  note(330, 0.16, "sine", 0.12, 0, 660);
  note(880, 0.22, "triangle", 0.1, 0.14);
}

/** Big celebratory fanfare for the final report. A little major arpeggio. */
export function sfxFanfare() {
  const base = 523.25; // C5
  note(base, 0.16, "triangle", 0.14, 0);
  note(base * 1.25, 0.16, "triangle", 0.14, 0.13); // E
  note(base * 1.5, 0.16, "triangle", 0.14, 0.26); // G
  note(base * 2, 0.42, "triangle", 0.16, 0.39); // C6, held
  note(base * 2, 0.42, "sine", 0.1, 0.39);
}

/** Samuel has news — a friendly two-tone "hey there!". */
export function sfxNotify() {
  note(587, 0.1, "sine", 0.12);
  note(784, 0.14, "sine", 0.12, 0.09);
}
