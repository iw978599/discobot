import { useEffect, useRef, useState } from 'react';
import type { Studio } from '../studio/useStudio';
import { createGuestPlayer, type GuestPlayer } from '../hooks/guestAudio';
import {
  GUEST_LATENCY_MS, GUEST_PROTOCOL, guestLink, guestOrigin, isTrustedOrigin, trustOrigin,
  type Guest, type GuestTransport,
} from '../services/guests';
import Knob from '../components/Knob';

const STATE_POLL_MS = 4000;
const ANSWER_WAIT_MS = 6000;

type Status = 'asking' | 'loading' | 'ready' | 'unanswered';

// One guest instrument: another creator's page in a frame, kept in time with the transport,
// with its sound brought into the mixer and its settings saved in the project.
export default function GuestModule({ studio, guest }: { studio: Studio; guest: Guest }) {
  const origin = guestOrigin(guest.url);
  const [allowed, setAllowed] = useState(() => isTrustedOrigin(origin));
  const [status, setStatus] = useState<Status>('loading');
  const [reported, setReported] = useState('');
  const [blocks, setBlocks] = useState(0);
  const [open, setOpen] = useState(true);
  const [reloads, setReloads] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<GuestPlayer | null>(null);
  const guestRef = useRef(guest);
  guestRef.current = guest;
  const savedState = useRef(JSON.stringify(guest.state ?? null));

  const level = guest.muted ? 0 : guest.volume;
  useEffect(() => { playerRef.current?.setVolume(level); }, [level]);

  useEffect(() => {
    if (!allowed) return;
    setStatus('loading');
    setBlocks(0);
    const send = (message: Record<string, unknown>) => {
      frameRef.current?.contentWindow?.postMessage({ discobotGuest: GUEST_PROTOCOL, ...message }, origin);
    };
    const sendTransport = (transport: GuestTransport) => send({ type: 'transport', ...transport });
    let ready = false;

    const onMessage = (event: MessageEvent) => {
      // Only this guest's own frame, at the address it was loaded from, is listened to.
      if (event.source !== frameRef.current?.contentWindow || event.origin !== origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || typeof data !== 'object' || data.discobotGuest !== GUEST_PROTOCOL) return;
      if (data.type === 'ready') {
        ready = true;
        setStatus('ready');
        const told = typeof data.name === 'string' ? data.name.trim().slice(0, 60) : '';
        setReported(told);
        // Until the guest says what it is called, it goes by its site's name.
        if (told && guestRef.current.name === new URL(guestRef.current.url).hostname) void studio.handleGuestChange(guestRef.current.id, { name: told });
        send({ type: 'hello', host: 'discobot', latencyMs: GUEST_LATENCY_MS });
        if (guestRef.current.state !== undefined) send({ type: 'setState', state: guestRef.current.state });
        send({ type: 'audio', on: true });
        sendTransport(guestLink.transport());
      } else if (data.type === 'state') {
        let text: string;
        try { text = JSON.stringify(data.state ?? null); } catch { return; }
        if (text === savedState.current) return;
        savedState.current = text;
        void studio.handleGuestChange(guestRef.current.id, { state: data.state });
      } else if (data.type === 'stateChanged') {
        send({ type: 'getState', id: 'changed' });
      } else if (data.type === 'audio') {
        playerRef.current ??= createGuestPlayer();
        playerRef.current.setVolume(guestRef.current.muted ? 0 : guestRef.current.volume);
        if (playerRef.current.push(data.wall, data.sampleRate, data.left, data.right)) setBlocks(playerRef.current.blocks);
      }
    };
    window.addEventListener('message', onMessage);
    const stopTransport = guestLink.subscribe((transport) => {
      if (!ready) return;
      if (!transport.playing) playerRef.current?.clear();
      sendTransport(transport);
    });
    // The guest cannot tell Discobot every time a knob moves, so its settings are asked for now and then.
    const poll = setInterval(() => { if (ready) send({ type: 'getState', id: 'poll' }); }, STATE_POLL_MS);
    const unanswered = setTimeout(() => { if (!ready) setStatus('unanswered'); }, ANSWER_WAIT_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      stopTransport();
      clearInterval(poll);
      clearTimeout(unanswered);
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, [allowed, origin, guest.url, reloads, studio.handleGuestChange]);

  const name = guest.name || reported || origin;
  return (
    <section className="rack-unit guest-unit" aria-label={`Guest instrument ${name}`} data-status={allowed ? status : 'asking'} data-audio-blocks={blocks}>
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
        <button
          className="rack-btn danger"
          onClick={() => { if (window.confirm(`Remove the guest instrument "${name}" from this project?`)) void studio.handleRemoveGuest(guest.id); }}
        >
          Remove
        </button>
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
          <p className="rack-hint">A guest plays live. It is not included in WAV or MIDI export, and it needs a connection to its own site.</p>
        </>
      )}
    </section>
  );
}
