let sharedAudioCtx: AudioContext | null = null;

function initAudio() {
  if (sharedAudioCtx) return;
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const activeCtx = new Ctx() as AudioContext;
    sharedAudioCtx = activeCtx;
    const buffer = activeCtx.createBuffer(1, 1, 22050);
    const node = activeCtx.createBufferSource();
    node.buffer = buffer;
    node.connect(activeCtx.destination);
    node.start(0);
  } catch (e) {
    console.error("Audio initialization failed:", e);
  }
}

if (typeof window !== "undefined") {
  const resumeAudio = () => {
    initAudio();
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().then(() => {
        window.removeEventListener("click", resumeAudio);
        window.removeEventListener("keydown", resumeAudio);
        window.removeEventListener("touchstart", resumeAudio);
      });
    }
  };
  window.addEventListener("click", resumeAudio);
  window.addEventListener("keydown", resumeAudio);
  window.addEventListener("touchstart", resumeAudio);
}

export function playWinSound() {
  try {
    initAudio();
    const ctx = sharedAudioCtx;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const notes = [
      { freq: 523.25, delay: 0, dur: 0.4 },
      { freq: 659.25, delay: 0.08, dur: 0.4 },
      { freq: 783.99, delay: 0.16, dur: 0.4 },
      { freq: 1046.50, delay: 0.24, dur: 0.6 },
    ];

    notes.forEach(({ freq, delay, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 2, ctx.currentTime + delay);

      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      gain2.gain.setValueAtTime(0, t);
      gain2.gain.linearRampToValueAtTime(0.04, t + 0.005);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

      osc.start(t);
      osc.stop(t + dur + 0.1);

      osc2.start(t);
      osc2.stop(t + dur + 0.1);
    });
  } catch {}
}

export function playLossSound() {
  try {
    initAudio();
    const ctx = sharedAudioCtx;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const notes = [
      { freq: 392.00, delay: 0, dur: 0.3 },
      { freq: 329.63, delay: 0.1, dur: 0.3 },
      { freq: 261.63, delay: 0.2, dur: 0.5 },
    ];

    notes.forEach(({ freq, delay, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.start(t);
      osc.stop(t + dur + 0.1);
    });
  } catch {}
}

export function playOpenSound() {
  try {
    initAudio();
    const ctx = sharedAudioCtx;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    const notes = [
      { freq: 880.00, delay: 0, dur: 0.15 },
      { freq: 1318.51, delay: 0.05, dur: 0.25 },
    ];

    notes.forEach(({ freq, delay, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

      osc.start(t);
      osc.stop(t + dur + 0.1);
    });
  } catch {}
}
