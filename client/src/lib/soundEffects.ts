const MUTE_STORAGE_KEY = 'truco_sfx_muted';

export type SoundEffectType =
    | 'card'
    | 'covered'
    | 'truco'
    | 'zap'
    | 'snipe'
    | 'emote'
    | 'signal'
    | 'win'
    | 'tick';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedAudioCtx) {
        sharedAudioCtx = new Ctx();
    }
    if (sharedAudioCtx.state === 'suspended') {
        void sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
}

export function isSoundMuted(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function setSoundMuted(muted: boolean): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
    } catch {
        // ignore storage errors
    }
}

export function playSoundEffect(effect: SoundEffectType): void {
    if (isSoundMuted()) return;
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    try {
        switch (effect) {
            case 'card': {
                // Crisp card snap onto felt: filtered noise burst + soft thump
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(220, now);
                osc.frequency.exponentialRampToValueAtTime(75, now + 0.085);
                gain.gain.setValueAtTime(0.18, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.095);
                break;
            }
            case 'covered': {
                // Muffled face-down slide
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(140, now);
                osc.frequency.exponentialRampToValueAtTime(55, now + 0.11);
                gain.gain.setValueAtTime(0.14, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.125);
                break;
            }
            case 'truco': {
                // Dramatic brassy Truco slam chord
                [146.83, 220, 293.66].forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.03);
                    osc.frequency.exponentialRampToValueAtTime(freq * 1.04, now + 0.35);
                    gain.gain.setValueAtTime(0.11, now + idx * 0.03);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(now + idx * 0.03);
                    osc.stop(now + 0.44);
                });
                break;
            }
            case 'zap': {
                // Electric laser sweep for Clubs Manilha ZAP
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(980, now);
                osc.frequency.exponentialRampToValueAtTime(110, now + 0.45);
                gain.gain.setValueAtTime(0.16, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.5);
                break;
            }
            case 'snipe': {
                // Metallic katana slash + high ring for +1 SNIPED!
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(520, now);
                osc.frequency.exponentialRampToValueAtTime(1480, now + 0.14);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.38);
                gain.gain.setValueAtTime(0.16, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.42);
                break;
            }
            case 'emote': {
                // Friendly pop bubble
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(420, now);
                osc.frequency.exponentialRampToValueAtTime(660, now + 0.09);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.12);
                break;
            }
            case 'signal': {
                // Subtle secret double-chirp for partner signals
                [587.33, 783.99].forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                    gain.gain.setValueAtTime(0.08, now + idx * 0.08);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.09);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(now + idx * 0.08);
                    osc.stop(now + idx * 0.08 + 0.1);
                });
                break;
            }
            case 'win': {
                // Rising victory arpeggio
                [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.09);
                    gain.gain.setValueAtTime(0.13, now + idx * 0.09);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.28);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(now + idx * 0.09);
                    osc.stop(now + idx * 0.09 + 0.3);
                });
                break;
            }
            case 'tick': {
                // Low-time countdown tick
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(880, now);
                gain.gain.setValueAtTime(0.04, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
                osc.connect(gain).connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.04);
                break;
            }
        }
    } catch {
        // Ignore Web Audio errors when autoplay is blocked
    }
}
