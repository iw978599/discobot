import { useEffect, useRef, useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { createGuestPlayer, type GuestPlayer } from '../hooks/guestAudio';
import {
  GUEST_LATENCY_MS, GUEST_PROTOCOL, guestCapture, guestLink, guestOrigin, isTrustedOrigin, trustOrigin,
  type Guest, type GuestTransport,
} from '../services/guests';
import Knob from '../components/Knob';

const STATE_POLL_MS = 4000;
const ANSWER_WAIT_MS = 6000;
const READOUT_MS = 500;
// How long a scene change waits for a guest to hand over its settings.
const CAPTURE_WAIT_MS = 400;

type Status = 'asking' | 'loading' | 'ready' | 'unanswered';
// What the unit can tell about a connected guest's sound.
interface Readout { blocks: number; late: number; latencyMs: number; failed: boolean; silentFor: number }

// One guest instrument: another creator's page in a frame, kept in time with the transport,
// with its sound brought into the mixer and its settings saved in the project.
export default function GuestModule({ studio, guest }: { studio: Studio; guest: Guest }) {
  const origin = guestOrigin(guest.url);
  const [allowed, setAllowed] = useState(() => isTrustedOrigin(origin));
  const [status, setStatus] = useState<Status>('loading');
  const [reported, setReported] = useState('');
  const [readout, setReadout] = useState<Readout>({ blocks: 0, late: 0, latencyMs: GUEST_LATENCY_MS, failed: false, silentFor: 0 });
  const [open, setOpen] = useState(true);
  const [reloads, setReloads] = useState(0);
  const [removing, setRemoving] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<GuestPlayer | null>(null);
  const guestRef = useRef(guest);
  guestRef.current = guest;
  // The guest's settings as last agreed with it: what it last reported, or what it was last sent.
  const savedState = useRef(JSON.stringify(guest.state ?? null));
  // Goes up each time settings are sent to the guest, so an answer to an earlier question, about
  // settings it no longer has, is not saved over the new ones.
  const epoch = useRef(0);
  const link = useRef<{ ready: boolean; send: (message: Record<string, unknown>) => void } | null>(null);

  // Settings that change from outside the guest, by opening another scene or a song moving on to
  // one, by sync or by restoring a version, are handed to it. A change of scene always does so,
  // even to the same settings: the guest may have been altered since it was last asked, and any
  // answer still on its way belongs to the scene that was left.
  const stateText = JSON.stringify(guest.state ?? null);
  const sceneId = studio.currentSceneId;
  const shownScene = useRef(sceneId);
  useEffect(() => {
    const sceneChanged = shownScene.current !== sceneId;
    shownScene.current = sceneId;
    if (!sceneChanged && stateText === savedState.current) return;
    savedState.current = stateText;
    epoch.current += 1;
    if (link.current?.ready && guestRef.current.state !== undefined) link.current.send({ type: 'setState', state: guestRef.current.state });
  }, [stateText, sceneId]);

  const level = guest.muted ? 0 : guest.volume;
  useEffect(() => { playerRef.current?.setVolume(level); }, [level]);

  useEffect(() => {
    if (!allowed) return;
    setStatus('loading');
    const id = guestRef.current.id;
    const send = (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage({ discobotGuest: GUEST_PROTOCOL, ...message }, origin);
    };
    const sendTransport = (transport: GuestTransport) => send({ type: 'transport', ...transport });
    let ready = false;
    link.current = { ready: false, send };
    let latencyMs = GUEST_LATENCY_MS;
    let playingSince = 0, blocksAtStart = 0;
    // "hello" may be sent again: it is how the guest learns it must play earlier.
    const hello = () => { send({ type: 'hello', host: 'discobot', latencyMs }); guestLink.connect(id, latencyMs); };

    const onMessage = (event: MessageEvent) => {
      // Only this guest's own frame, at the address it was loaded from, is listened to.
      if (event.source !== frameRef.current?.contentWindow || event.origin !== origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || data.discobotGuest !== GUEST_PROTOCOL) return;
      if (data.type === 'ready') {
        ready = true;
        link.current = { ready: true, send };
        setStatus('ready');
        const told = typeof data.name === 'string' ? data.name.trim().slice(0, 60) : '';
        setReported(told);
        // Until the guest says what it is called, it goes by its site's name.
        if (told && guestRef.current.name === new URL(guestRef.current.url).hostname) void studio.handleGuestChange(id, { name: told });
        hello();
        if (guestRef.current.state !== undefined) send({ type: 'setState', state: guestRef.current.state });
        send({ type: 'audio', on: true });
        sendTransport(guestLink.transport());
      } else if (data.type === 'state') {
        // An answer to a question asked before the guest was last given settings describes the old ones.
        const asked = String(data.id);
        if (asked !== `ask:${epoch.current}` && !asked.startsWith(`ask:${epoch.current}:`)) return;
        const done = waiting.get(asked);
        waiting.delete(asked);
        let text: string;
        try { text = JSON.stringify(data.state ?? null); } catch { done?.(); return; }
        if (text === savedState.current) { done?.(); return; }
        savedState.current = text;
        void studio.handleGuestChange(id, { state: data.state }).then(() => done?.(), () => done?.());
      } else if (data.type === 'stateChanged') {
        send({ type: 'getState', id: `ask:${epoch.current}` });
      } else if (data.type === 'audio') {
        if (!playerRef.current) {
          playerRef.current = createGuestPlayer((next) => { latencyMs = next; hello(); }, latencyMs);
          playerRef.current.setVolume(guestRef.current.muted ? 0 : guestRef.current.volume);
        }
        // This runs for every block of audio, many times a second, so it must not re-render anything.
        if (playerRef.current.push(data.wall, data.sampleRate, data.left, data.right)) {
          // While an export is being recorded, the same audio is kept for it.
          guestCapture.feed(id, data.wall as number, data.sampleRate as number, data.left as Float32Array, data.right as Float32Array, latencyMs);
        }
      }
    };
    window.addEventListener('message', onMessage);
    const noteTransport = (transport: GuestTransport) => {
      playingSince = transport.playing ? Date.now() : 0;
      blocksAtStart = playerRef.current?.stats.blocks ?? 0;
    };
    noteTransport(guestLink.transport());
    const stopTransport = guestLink.subscribe((transport) => {
      noteTransport(transport);
      if (!ready) return;
      if (!transport.playing) playerRef.current?.clear();
      sendTransport(transport);
    });
    // The guest cannot tell Discobot every time a knob moves, so its settings are asked for now and then.
    // Fetches the guest's settings now and resolves once they are saved, or after a short wait if
    // the guest does not answer.
    const waiting = new Map<string, () => void>();
    let asks = 0;
    guestLink.onCapture(id, () => new Promise<void>((resolve) => {
      if (!ready) { resolve(); return; }
      const ask = `ask:${epoch.current}:${++asks}`;
      waiting.set(ask, resolve);
      send({ type: 'getState', id: ask });
      setTimeout(() => { waiting.delete(ask); resolve(); }, CAPTURE_WAIT_MS);
    }));
    const poll = setInterval(() => { if (ready) send({ type: 'getState', id: `ask:${epoch.current}` }); }, STATE_POLL_MS);
    const unanswered = setTimeout(() => { if (!ready) setStatus('unanswered'); }, ANSWER_WAIT_MS);
    // What is shown about the sound is refreshed a couple of times a second, not per block.
    const show = setInterval(() => {
      const stats = playerRef.current?.stats;
      const blocks = stats?.blocks ?? 0;
      setReadout({
        blocks, late: stats?.late ?? 0, latencyMs: stats?.latencyMs ?? latencyMs, failed: stats?.failed ?? false,
        silentFor: playingSince > 0 && blocks === blocksAtStart ? Date.now() - playingSince : 0,
      });
    }, READOUT_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      stopTransport();
      clearInterval(poll);
      clearInterval(show);
      clearTimeout(unanswered);
      guestLink.disconnect(id);
      link.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [allowed, origin, guest.url, reloads, studio.handleGuestChange]);

  const name = guest.name || reported || origin;
  // Plain statements of what is wrong, when something is, so a silent guest explains itself.
  const trouble = status !== 'ready' ? ''
    : readout.failed ? 'Discobot could not set up the sound for this guest. Reload the page.'
      : readout.silentFor > 2500 ? 'Playing, but no sound has arrived from this guest. Click inside it once; some browsers need that before a page in a frame may make sound.'
        : readout.latencyMs > GUEST_LATENCY_MS ? `Sound from this guest takes longer than usual to arrive in this browser, so it now plays ${readout.latencyMs} ms ahead to stay in time. Pressing play takes a little longer to start.`
          : '';
  return (
    <section
      className="rack-unit guest-unit"
      aria-label={`Guest instrument ${name}`}
      data-status={allowed ? status : 'asking'}
      data-audio-blocks={readout.blocks}
      data-late-blocks={readout.late}
      data-latency={readout.latencyMs}
    >
      <div className="rack-row">
        <div className="rack-plate static">
          <b>Guest</b>
          <span title={guest.url}>{name}</span>
        </div>
        <div className="rack-ms">
          <button className={guest.muted ? 'on' : ''} aria-label={`Mute guest ${name}`} aria-pressed={guest.muted} onClick={() => { void studio.handleGuestChange(guest.id, { muted: !guest.muted }); }}>M</button>
        </div>
        <span className="rack-hint guest-status" role="status">
          {!allowed ? 'Not loaded'
            : status === 'ready' ? `Connected · from ${origin}`
              : status === 'unanswered' ? 'This page has not answered. It may not support Discobot yet, so it will not follow the tempo or go through the mixer.'
                : 'Loading…'}
        </span>
        <div className="rack-grow" />
        <button className="rack-btn" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? 'Hide' : 'Show'}</button>
        <button className="rack-btn" disabled={!allowed} title="Load the guest's page again" onClick={() => setReloads(count => count + 1)}>Reload</button>
        {removing ? (
          // Asked for here in the page, not in a browser dialog, which a browser can be told to stop showing.
          <span className="guest-confirm" role="group" aria-label={`Remove ${name}?`}>
            <button className="rack-btn danger" autoFocus onClick={() => { void studio.handleRemoveGuest(guest.id); }}>Remove It</button>
            <button className="rack-btn" onClick={() => setRemoving(false)}>Keep</button>
          </span>
        ) : (
          <button className="rack-btn danger" title="Take this guest out of the project" onClick={() => setRemoving(true)}>Remove</button>
        )}
        <Knob
          size="small"
          label="Level"
          ariaLabel={`Guest ${name} level`}
          value={guest.volume}
          displayValue={`${Math.round(guest.volume * 100)}%`}
          parseInputValue={(input) => { const value = Number.parseFloat(input); return Number.isFinite(value) ? value / 100 : null; }}
          onChange={(value) => { void studio.handleGuestChange(guest.id, { volume: value }); }}
          color="#f1f1ee"
        />
      </div>
      {trouble && <p className="guest-trouble" role="alert">{trouble}</p>}
      {!allowed ? (
        <div className="guest-ask">
          <p>
            This project uses a guest instrument from <strong>{origin}</strong>. Loading it opens that site's page inside Discobot, which contacts that site.
            The page cannot read your projects or your account.
          </p>
          <button className="rack-btn go" onClick={() => { trustOrigin(origin); setAllowed(true); }}>Load It</button>
        </div>
      ) : (
        <>
          <iframe
            key={reloads}
            ref={frameRef}
            className="guest-frame"
            hidden={!open}
            title={`${name} (guest instrument)`}
            src={guest.url}
            // The page is always from another site (see guestUrl), so it keeps its own storage
            // and scripts without gaining any access to Discobot's.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            allow="autoplay"
            referrerPolicy="no-referrer"
          />
          <p className="rack-hint">A guest plays live and needs a connection to its own site. Its settings, level and mute are kept per scene, like each lane's notes. Download WAV and Song WAV record it by playing through once; it is not in Loop WAV, stems or MIDI.</p>
        </>
      )}
    </section>
  );
}
