// The trial page: compiles Surge's module here, hands it to the worklet, and sends notes and macros.
const $ = (id) => document.getElementById(id);
let node = null, octave = 48, chordHeld = false;
const held = new Set();
const KEYS = 'awsedftgyhujk';
const CHORD = [48, 52, 55, 59, 62, 64, 67, 71];

function on(note) { if (!node || held.has(note)) return; held.add(note); node.port.postMessage({ type: 'on', note }); paint(); }
function off(note) { if (!node || !held.has(note)) return; held.delete(note); node.port.postMessage({ type: 'off', note }); paint(); }
function paint() { for (const key of $('keys').children) key.classList.toggle('held', held.has(Number(key.dataset.note))); }

function drawKeys() {
  $('keys').replaceChildren(...[...KEYS].map((key, i) => {
    const button = document.createElement('button');
    button.textContent = key.toUpperCase();
    button.dataset.note = String(octave + i);
    button.addEventListener('pointerdown', () => on(octave + i));
    button.addEventListener('pointerup', () => off(octave + i));
    button.addEventListener('pointerleave', () => off(octave + i));
    return button;
  }));
}

async function loadPatch(path) {
  const bytes = await (await fetch(`patches/${path.split('/').map(encodeURIComponent).join('/')}`)).arrayBuffer();
  node.port.postMessage({ type: 'patch', bytes }, [bytes]);
}

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  $('status').textContent = 'Loading Surge…';
  const context = new AudioContext({ latencyHint: 'interactive' });
  const wasm = await (await fetch('surge-trial.wasm')).arrayBuffer();
  const t = performance.now();
  const module = await WebAssembly.compile(wasm);
  const compileMs = performance.now() - t;
  await context.audioWorklet.addModule('surge-worklet.js');
  node = new AudioWorkletNode(context, 'surge-trial', { numberOfOutputs: 1, outputChannelCount: [2] });
  node.connect(context.destination);
  node.port.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      $('status').textContent = `Running at ${context.sampleRate} Hz. Module ${(wasm.byteLength / 1e6).toFixed(1)} MB, compiled in ${compileMs.toFixed(0)} ms.`;
      for (const id of ['patch', 'lanes', 'chord']) $(id).disabled = false;
      loadPatch($('patch').value);
    } else if (data.type === 'patch') {
      $('patchInfo').textContent = data.result === 0 ? `${data.name || 'Loaded'}: loaded in ${data.ms.toFixed(0)} ms.` : `This patch did not load (code ${data.result}).`;
      $('macros').replaceChildren(...data.macros.map((name, index) => {
        const label = document.createElement('label');
        const slider = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.001, value: 0 });
        slider.addEventListener('input', () => node.port.postMessage({ type: 'macro', index, value: Number(slider.value) }));
        label.append(name || `Macro ${index + 1}`, slider);
        return label;
      }));
    } else if (data.type === 'load') {
      $('meter').textContent = `${(data.share * 100).toFixed(1)}% on average, ${(data.worst * 100).toFixed(0)}% at worst`;
      $('meterNote').textContent = data.precise ? '' : 'This browser gives the worklet only a coarse clock, so the figures are approximate.';
    }
  };
  const patches = await (await fetch('patches.json')).json();
  $('patch').replaceChildren(...patches.map((path) => Object.assign(document.createElement('option'), { value: path, textContent: path.replace(/\.fxp$/, '') })));
  node.port.postMessage({ type: 'init', module });
});

$('patch').addEventListener('change', () => loadPatch($('patch').value));
$('lanes').addEventListener('change', () => node.port.postMessage({ type: 'lanes', count: Number($('lanes').value) }));
$('chord').addEventListener('click', () => {
  chordHeld = !chordHeld;
  $('chord').textContent = chordHeld ? 'Let go of the chord' : 'Hold an 8-note chord';
  for (const note of CHORD) (chordHeld ? on : off)(note);
});
window.addEventListener('keydown', (event) => {
  if (event.repeat || event.target instanceof HTMLSelectElement) return;
  const key = event.key.toLowerCase();
  if (key === 'z') { octave = Math.max(24, octave - 12); drawKeys(); return; }
  if (key === 'x') { octave = Math.min(84, octave + 12); drawKeys(); return; }
  const index = KEYS.indexOf(key);
  if (index >= 0) on(octave + index);
});
window.addEventListener('keyup', (event) => { const index = KEYS.indexOf(event.key.toLowerCase()); if (index >= 0) off(octave + index); });
drawKeys();
