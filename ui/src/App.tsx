import { useState, useCallback, useRef } from 'react';
import Sequencer from './components/Sequencer';
import Keyboard from './components/Keyboard';
import SynthControls from './components/SynthControls';
import DrumMachine from './components/DrumMachine';
import { useWebSocket } from './hooks/useWebSocket';
import { apiUrl, getWebSocketUrl } from './config';
import { Pattern, SynthParameters, SavedPatternFull, DrumState, DrumInstrument, DrumSettings } from './types';
import './App.css';

const DEFAULT_PARAMS: SynthParameters = {
  gain: 1.0,
  oscillator: { type: 'sine', detune: 0 },
  filter: { frequency: 20000, q: 1, type: 'lowpass' },
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3 },
  effects: {
    reverb: { enabled: false, wet: 0.3, decay: 2 },
    delay: { enabled: false, wet: 0.3, time: 0.25, feedback: 0.3 },
  },
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_FREQ: Record<string, number> = {};
for (let oct = 3; oct <= 5; oct++) {
  for (let i = 0; i < NOTE_NAMES.length; i++) {
    const midi = (oct + 1) * 12 + i;
    NOTE_FREQ[`${NOTE_NAMES[i]}${oct}`] = 440 * Math.pow(2, (midi - 69) / 12);
  }
}

function App() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeVoices = useRef<Map<string, { osc: OscillatorNode; gain: GainNode }>>(new Map());

  function getAudioContext() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  function playBrowserNote(note: string, duration?: number) {
    if (browserMutedRef.current) return;
    const freq = NOTE_FREQ[note];
    if (!freq) return;
    try {
      const ctx = getAudioContext();
      const p = synthParamsRef.current;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = p?.oscillator.type || 'sine';
      osc.frequency.value = freq;
      osc.detune.value = p?.oscillator.detune || 0;

      if (p) {
        const filter = ctx.createBiquadFilter();
        filter.type = (p.filter.type || 'lowpass') as BiquadFilterType;
        filter.frequency.value = p.filter.frequency;
        filter.Q.value = p.filter.q;
        osc.connect(filter);
        filter.connect(gain);
      } else {
        osc.connect(gain);
      }

      if (p?.effects.delay.enabled && p.effects.delay.wet > 0) {
        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const delayNode = ctx.createDelay(p.effects.delay.time);
        const feedbackGain = ctx.createGain();
        const outputGain = ctx.createGain();

        dryGain.gain.value = 1 - p.effects.delay.wet;
        wetGain.gain.value = p.effects.delay.wet;
        delayNode.delayTime.value = p.effects.delay.time;
        feedbackGain.gain.value = p.effects.delay.feedback;

        gain.connect(dryGain);
        gain.connect(delayNode);
        delayNode.connect(wetGain);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        dryGain.connect(outputGain);
        wetGain.connect(outputGain);
        outputGain.connect(ctx.destination);
      } else {
        gain.connect(ctx.destination);
      }

      const now = ctx.currentTime;
      const attack = p?.envelope.attack ?? 0.01;
      const decay = p?.envelope.decay ?? 0.1;
      const sustainLvl = p?.envelope.sustain ?? 0.7;
      const release = p?.envelope.release ?? 0.3;
      const vol = (p?.gain ?? 1.0) * 0.3;

      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(vol, now + attack);
      gain.gain.linearRampToValueAtTime(vol * sustainLvl, now + attack + decay);

      osc.start(now);

      if (duration) {
        const end = now + Math.max(duration, attack + decay + 0.01);
        gain.gain.setValueAtTime(vol * sustainLvl, end - release);
        gain.gain.exponentialRampToValueAtTime(0.001, end);
        osc.stop(end);
      } else {
        activeVoices.current.set(note, { osc, gain });
      }
    } catch {}
  }

  function playDrumHit(instrument: DrumInstrument, settings: DrumSettings) {
    if (browserMutedRef.current) return;
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      const sampleRate = ctx.sampleRate;
      const pcm = generateDrumPCM(instrument, settings, sampleRate);
      let maxVal = 0;
      for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > maxVal) maxVal = a; }
      console.log(`playDrumHit: ${instrument}, len=${pcm.length}, max=${maxVal.toFixed(4)}`);
      if (maxVal < 0.01) { console.warn('Drum PCM too quiet, boosting'); for (let i = 0; i < pcm.length; i++) pcm[i] *= 10; }
      const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
      buffer.getChannelData(0).set(pcm);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = 1.0;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start();
      console.log('playDrumHit: started');
    } catch (e) {
      console.error('playDrumHit error:', e);
    }
  }

  function generateDrumPCM(instrument: DrumInstrument, settings: DrumSettings, sampleRate: number): Float32Array {
    const vol = Math.max(0, Math.min(1, settings.volume));
    const tone = Math.max(0, Math.min(1, settings.tone));
    const extra = Math.max(0, Math.min(1, settings.extra));
    switch (instrument) {
      case 'kick': return genKick(vol, tone, extra, sampleRate);
      case 'snare': return genSnare(vol, tone, extra, sampleRate);
      case 'openHH': return genOpenHH(vol, tone, extra, sampleRate);
      case 'closedHH': return genClosedHH(vol, tone, extra, sampleRate);
      case 'ride': return genRide(vol, tone, extra, sampleRate);
      case 'crash': return genCrash(vol, tone, extra, sampleRate);
      case 'snare2': return genSnare2(vol, tone, extra, sampleRate);
      case 'clap': return genClap(vol, tone, extra, sampleRate);
    }
  }

  function genKick(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const startFreq = 60 + tone * 180;
    const dur = 0.08 + extra * 0.42;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let phase = 0;
    const ratio = 30 / startFreq;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const freq = startFreq * Math.pow(ratio, t / dur);
      phase += freq / sr;
      const env = Math.exp(-t * 4 / dur);
      out[i] = Math.sin(2 * Math.PI * phase) * env * volume;
    }
    return out;
  }

  function genSnare(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const bodyStart = 260 + tone * 140;
    const bodyEnd = 140 + tone * 50;
    const snappy = 0.35 + extra * 0.65;
    const dur = 0.16;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let bodyPhase1 = 0;
    let bodyPhase2 = 0;
    let prevNoise = 0;
    const sweepDur = 0.032;
    const bodySweep = bodyEnd / bodyStart;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const sweepPos = Math.min(t / sweepDur, 1);
      const bodyFreq = bodyStart * Math.pow(bodySweep, sweepPos);
      bodyPhase1 += bodyFreq / sr;
      bodyPhase2 += (bodyFreq * 1.43) / sr;
      const bodyEnv = Math.exp(-t * (26 + (1 - extra) * 12));
      const body = (Math.sin(2 * Math.PI * bodyPhase1) * 0.65 + Math.sin(2 * Math.PI * bodyPhase2) * 0.35) * bodyEnv * 0.18;
      const noiseEnv = Math.exp(-t * (10 + snappy * 22));
      const snap = hpNoise * (0.75 + tone * 0.25) + noise * 0.35;
      out[i] = (snap * noiseEnv * snappy + body) * volume;
    }
    return out;
  }

  function genOpenHH(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const dur = 0.05 + extra * 0.45;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let prevNoise = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const env = Math.exp(-t * 5 / dur);
      const brightness = 0.3 + tone * 0.7;
      out[i] = hpNoise * env * volume * brightness * 1.5;
    }
    return out;
  }

  function genClosedHH(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const dur = 0.015 + (1 - extra) * 0.085;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let prevNoise = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const env = Math.exp(-t * 12 / dur);
      const brightness = 0.4 + tone * 0.6;
      out[i] = hpNoise * env * volume * brightness * 1.5;
    }
    return out;
  }

  function genRide(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const base = 300 + tone * 180;
    const dur = 0.9 + extra * 1.9;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let p1 = 0, p2 = 0, p3 = 0, p4 = 0;
    let lpNoise = 0;
    let prevNoise = 0;
    const bellAmt = 0.015 + tone * 0.045;
    const shimmerAmt = 0.24 + tone * 0.2;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      p1 += base / sr;
      p2 += base * 1.47 / sr;
      p3 += base * 1.93 / sr;
      p4 += base * 2.37 / sr;
      const partials = (
        Math.sin(2 * Math.PI * p1) * 0.2 +
        Math.sin(2 * Math.PI * p2) * 0.17 +
        Math.sin(2 * Math.PI * p3) * 0.12 +
        Math.sin(2 * Math.PI * p4) * 0.08
      );
      const noise = Math.random() * 2 - 1;
      lpNoise = lpNoise * 0.82 + noise * 0.18;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const stickEnv = Math.exp(-t * 78);
      const bodyEnv = Math.exp(-t * (1.75 / dur));
      const tailEnv = Math.exp(-t * (0.9 / dur));
      const bell = Math.sin(2 * Math.PI * p4) * Math.exp(-t * 7.2) * bellAmt;
      const stick = hpNoise * stickEnv * (0.28 + tone * 0.12);
      const shimmer = partials * bodyEnv * shimmerAmt;
      const wash = lpNoise * tailEnv * (0.34 + extra * 0.26);
      out[i] = Math.tanh((stick + shimmer + wash + bell) * 0.95) * volume * 0.74;
    }
    return out;
  }

  function genCrash(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const dur = 0.2 + extra * 1.0;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let prevNoise = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const env = Math.exp(-t * 3 / dur);
      const brightness = 0.2 + tone * 0.8;
      out[i] = hpNoise * env * volume * brightness;
    }
    return out;
  }

  function genSnare2(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const bodyStart = 320 + tone * 180;
    const bodyEnd = 180 + tone * 80;
    const snappy = 0.45 + extra * 0.55;
    const dur = 0.14;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let bodyPhase = 0;
    let prevNoise = 0;
    const sweepDur = 0.02;
    const bodySweep = bodyEnd / bodyStart;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const noise = Math.random() * 2 - 1;
      const hpNoise = noise - prevNoise;
      prevNoise = noise;
      const sweepPos = Math.min(t / sweepDur, 1);
      const bodyFreq = bodyStart * Math.pow(bodySweep, sweepPos);
      bodyPhase += bodyFreq / sr;
      const body = Math.sin(2 * Math.PI * bodyPhase) * Math.exp(-t * 34) * 0.14;
      const noiseEnv = Math.exp(-t * (14 + snappy * 16));
      out[i] = ((hpNoise * (0.85 + tone * 0.2) + noise * 0.2) * noiseEnv * snappy + body) * volume;
    }
    return out;
  }

  function genClap(volume: number, tone: number, extra: number, sr: number): Float32Array {
    const dur = 0.17 + extra * 0.16;
    const len = Math.floor(sr * dur);
    const out = new Float32Array(len);
    let lpNoise = 0;
    const bodyFreq = 170 + tone * 130;
    const decay = 26 - extra * 10;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const noise = Math.random() * 2 - 1;
      lpNoise = lpNoise * 0.82 + noise * 0.18;
      const hpNoise = noise - lpNoise;
      const attack = Math.min(t / 0.0018, 1);
      const env = attack * Math.exp(-t * decay);
      const body = Math.sin(2 * Math.PI * bodyFreq * t) * Math.exp(-t * 42) * 0.08;
      out[i] = Math.tanh((hpNoise * 0.95 + noise * 0.18) * env + body) * volume * 0.82;
    }
    return out;
  }

  function stopBrowserNote(note: string) {
    const voice = activeVoices.current.get(note);
    if (voice) {
      try {
        const ctx = getAudioContext();
        const now = ctx.currentTime;
        const release = synthParamsRef.current?.envelope.release ?? 0.3;
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
        voice.gain.gain.exponentialRampToValueAtTime(0.001, now + release);
        voice.osc.stop(now + release);
      } catch {}
      activeVoices.current.delete(note);
    }
  }
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [currentPattern, setCurrentPattern] = useState<Pattern | null>(null);
  const [synthParams, setSynthParams] = useState<SynthParameters | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const defaultDrumState = (): DrumState => ({
    kick: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    snare: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    openHH: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    closedHH: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    ride: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    crash: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    snare2: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
    clap: { steps: new Array(16).fill(false), settings: { volume: 1.0, tone: 0.5, extra: 0.5 } },
  });
  const [drumState, setDrumState] = useState<DrumState>(defaultDrumState);
  const drumStateRef = useRef(drumState);
  drumStateRef.current = drumState;
  const [drumMasterVolume, setDrumMasterVolume] = useState(1.0);
  const currentPatternRef = useRef(currentPattern);
  currentPatternRef.current = currentPattern;
  const selectedStepRef = useRef(selectedStep);
  selectedStepRef.current = selectedStep;
  const [browserMuted, setBrowserMuted] = useState(false);
  const browserMutedRef = useRef(browserMuted);
  browserMutedRef.current = browserMuted;
  const synthParamsRef = useRef(synthParams);
  synthParamsRef.current = synthParams;

  const handleMessage = useCallback((message: any) => {
    switch (message.type) {
      case 'init':
        setSynthParams(message.data.synthParameters);
        setPatterns(message.data.patterns);
        if (message.data.drumState) setDrumState(message.data.drumState);
        if (message.data.patterns.length > 0) {
          setCurrentPattern(message.data.patterns[0]);
        }
        if (!message.data.hasActiveSession) {
          setIsPlaying(false);
          setCurrentStep(0);
        }
        break;
      case 'synthUpdate':
        setSynthParams(message.data);
        break;
      case 'patternCreated':
        setPatterns((prev: Pattern[]) => [...prev, message.data]);
        break;
      case 'patternUpdated':
        setPatterns((prev: Pattern[]) =>
          prev.map((p: Pattern) => (p.id === message.data.id ? message.data : p))
        );
        setCurrentPattern((prev: Pattern | null) =>
          prev?.id === message.data.id ? message.data : prev
        );
        break;
      case 'sequencerPlay':
        setIsPlaying(true);
        break;
      case 'sequencerStop':
        setIsPlaying(false);
        setCurrentStep(0);
        break;
      case 'sequencerStep': {
        const stepIndex = message.data.step;
        setCurrentStep(stepIndex);
        const cur = currentPatternRef.current;
        if (cur && cur.steps[stepIndex]?.note) {
          playBrowserNote(cur.steps[stepIndex].note!, 0.15);
        }
        const ds = drumStateRef.current;
        if (ds) {
          for (const inst of Object.keys(ds) as DrumInstrument[]) {
            const track = ds[inst];
            if (track.steps[stepIndex]) {
              playDrumHit(inst, track.settings);
            }
          }
        }
        break;
      }
      case 'drumStep': {
        const { instrument: di, step: ds, active: da } = message.data;
        setDrumState((prev) => {
          const next = { ...prev };
          next[di as DrumInstrument] = {
            ...next[di as DrumInstrument],
            steps: [...next[di as DrumInstrument].steps],
          };
          next[di as DrumInstrument].steps[ds as number] = da as boolean;
          return next;
        });
        break;
      }
      case 'drumSettings': {
        const { instrument: dsi, settings: dss } = message.data;
        setDrumState((prev) => {
          const next = { ...prev };
          const inst = dsi as DrumInstrument;
          next[inst] = {
            ...next[inst],
            settings: { ...next[inst].settings, ...dss },
          };
          return next;
        });
        break;
      }
      case 'drumReset': {
        setDrumState(defaultDrumState());
        break;
      }
      case 'drumFullState': {
        if (message.data.drumState) setDrumState(message.data.drumState);
        break;
      }
    }
  }, []);

  const connected = useWebSocket(getWebSocketUrl(), handleMessage);

  const handleTempoChange = async (bpm: number) => {
    if (!currentPattern) return;

    const updatedPattern = { ...currentPattern, tempo: bpm };
    setCurrentPattern(updatedPattern);

    await Promise.all([
      fetch(apiUrl(`/patterns/${currentPattern.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedPattern),
      }),
      fetch(apiUrl('/sequencer/tempo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempo: bpm }),
      }),
    ]);
  };

  const handlePlayStop = async () => {
    if (!currentPattern) return;

    const endpoint = isPlaying ? '/sequencer/stop' : '/sequencer/play';
    const body = isPlaying ? {} : { patternId: currentPattern.id };

    await fetch(apiUrl(endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  const handlePatternChange = (pattern: Pattern) => {
    setCurrentPattern(pattern);
  };

  const handleStepChange = async (stepIndex: number) => {
    if (!currentPattern) return;
    setSelectedStep((prev) => (prev === stepIndex ? null : stepIndex));
  };

  const handleNotePlay = (note: string) => {
    playBrowserNote(note);

    const step = selectedStepRef.current;
    const pattern = currentPatternRef.current;
    if (step === null || !pattern) return;

    const updated = { ...pattern };
    updated.steps = updated.steps.map((s, i) =>
      i === step ? { ...s, note, active: true } : s
    );

    setPatterns((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setCurrentPattern(updated);

    fetch(apiUrl(`/patterns/${pattern.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
  };



  const handleNoteRelease = async (note: string) => {
    stopBrowserNote(note);

    await fetch(apiUrl('/synth/note-off'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
  };

  const handleSynthParamChange = async (params: Partial<SynthParameters>) => {
    await fetch(apiUrl('/synth/parameters'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  };

  const handleDrumStepToggle = useCallback((instrument: DrumInstrument, step: number, active: boolean) => {
    playDrumHit(instrument, drumStateRef.current[instrument].settings);
    setDrumState((prev) => {
      const next = { ...prev };
      next[instrument] = { ...next[instrument], steps: [...next[instrument].steps] };
      next[instrument].steps[step] = active;
      return next;
    });
    fetch(apiUrl('/drum/step'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, step, active }),
    }).catch(() => {});
  }, []);

  const handleDrumSettingsChange = useCallback((instrument: DrumInstrument, settings: Partial<DrumSettings>) => {
    setDrumState((prev) => {
      const next = { ...prev };
      next[instrument] = {
        ...next[instrument],
        settings: { ...next[instrument].settings, ...settings },
      };
      return next;
    });
    fetch(apiUrl('/drum/settings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument, settings }),
    }).catch(() => {});
  }, []);

  const handleDrumReset = useCallback(() => {
    setDrumState(defaultDrumState());
    fetch(apiUrl('/drum/reset'), { method: 'POST' }).catch(() => {});
  }, []);

  const handleDrumMasterVolumeChange = useCallback((volume: number) => {
    setDrumMasterVolume(volume);
    fetch(apiUrl('/drum/master-volume'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume }),
    }).catch(() => {});
  }, []);

  const handleSavePattern = async (name: string) => {
    const pattern = currentPatternRef.current;
    if (!pattern || !synthParamsRef.current) return;
    try {
      await fetch(apiUrl('/patterns/save'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          steps: pattern.steps,
          synthParams: synthParamsRef.current,
          tempo: pattern.tempo,
          drumState: drumStateRef.current,
          drumMasterVolume,
        }),
      });
    } catch { /* ignore */ }
  };

  const handleLoadSavedPattern = async (data: SavedPatternFull) => {
    if (!currentPatternRef.current) return;
    const pattern = currentPatternRef.current;
    const updated = { ...pattern, steps: data.steps, tempo: data.tempo };
    setCurrentPattern(updated);
    setPatterns((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setSelectedStep(null);
    if (data.drumState && typeof data.drumState === 'object') {
      setDrumState(data.drumState);
      await fetch(apiUrl('/drum/state'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: data.drumState }),
      }).catch(() => {});
    }
    if (data.drumMasterVolume !== undefined) {
      setDrumMasterVolume(data.drumMasterVolume);
      await fetch(apiUrl('/drum/master-volume'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume: data.drumMasterVolume }),
      }).catch(() => {});
    }
    if (data.synthParams) {
      setSynthParams(data.synthParams);
      await fetch(apiUrl('/synth/parameters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data.synthParams),
      }).catch(() => {});
    }
    await fetch(apiUrl(`/patterns/${pattern.id}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated),
    }).catch(() => {});
    await fetch(apiUrl('/sequencer/tempo'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempo: data.tempo }),
    }).catch(() => {});
  };

  const handleReset = () => {
    setSynthParams(DEFAULT_PARAMS);
    handleDrumReset();
    if (currentPatternRef.current) {
      const pattern = currentPatternRef.current;
      const cleared = { ...pattern };
      cleared.steps = cleared.steps.map((s) => ({ ...s, active: false, note: undefined }));
      setCurrentPattern(cleared);
      setPatterns((prev) => prev.map((p) => (p.id === cleared.id ? cleared : p)));
      setSelectedStep(null);
      setIsPlaying(false);
      setCurrentStep(0);

      fetch(apiUrl(`/patterns/${pattern.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleared),
      }).catch(() => {});
      fetch(apiUrl('/synth/parameters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_PARAMS),
      }).catch(() => {});

      if (isPlaying) {
        fetch(apiUrl('/sequencer/stop'), { method: 'POST' }).catch(() => {});
      }
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Discord Synth Bot</h1>
        <div className="header-controls">
          <button className="reset-button" onClick={handleReset} title="Reset pattern and synth to defaults">
            &#8634;
          </button>
          <button
            className={`mute-button ${browserMuted ? 'muted' : ''}`}
            onClick={() => setBrowserMuted((m) => !m)}
            title={browserMuted ? 'Unmute browser audio (Discord audio unaffected)' : 'Mute browser audio (Discord audio unaffected)'}
          >
            {browserMuted ? '🔇' : '🔊'}
          </button>
          <div className="status">
            <span className={`status-indicator ${connected ? 'connected' : 'disconnected'}`} />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </header>

      <div className="app-content">
        <div className="left-panel">
          <Sequencer
            pattern={currentPattern}
            patterns={patterns}
            isPlaying={isPlaying}
            currentStep={currentStep}
            selectedStep={selectedStep}
            onPlayStop={handlePlayStop}
            onPatternChange={handlePatternChange}
            onStepChange={handleStepChange}
            onTempoChange={handleTempoChange}
            onSavePattern={handleSavePattern}
            onLoadSavedPattern={handleLoadSavedPattern}
          />

          <Keyboard onNotePlay={handleNotePlay} onNoteRelease={handleNoteRelease} />

          <DrumMachine
            drumState={drumState}
            isPlaying={isPlaying}
            currentStep={currentStep}
            onStepToggle={handleDrumStepToggle}
            onSettingsChange={handleDrumSettingsChange}
            onReset={handleDrumReset}
            drumMasterVolume={drumMasterVolume}
            onMasterVolumeChange={handleDrumMasterVolumeChange}
          />
        </div>

        <div className="right-panel">
          {synthParams && (
            <SynthControls
              parameters={synthParams}
              onParameterChange={handleSynthParamChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
