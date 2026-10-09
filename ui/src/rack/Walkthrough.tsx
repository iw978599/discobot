import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

interface Stop {
  // What to light up. Several matches are lit as one area; none, and the card stands alone.
  target: string;
  title: string;
  text: string;
}

// In the order the rack is read, top to bottom, then back up to the menus.
const STOPS: Stop[] = [
  { target: '.tempo-display-group, .play-all-button', title: 'Play and tempo', text: 'Play All starts every lane and the drums together. Click the BPM display to type a tempo, or tap one in with Tap.' },
  { target: '.song-module', title: 'Scenes and song', text: 'A scene is one pattern of everything: every lane and the drum grid. Add more scenes, then put them in order as a song with + Add.' },
  { target: '.synth-module[aria-label="Synth 1 module"] .step-row', title: 'A lane\'s steps', text: 'Each synth lane is a row of steps. Select a step, then play a key to put a note on it. Click the lane\'s name to open it for editing.' },
  { target: '.synth-controls-panel', title: 'The sound editor', text: 'This is the open lane\'s editor. Notes has the keyboard and the piano roll. The other tabs shape the sound, and a sound you like can be saved as a preset.' },
  { target: '.drum-grid', title: 'The drum grid', text: 'Click cells to add hits. The strip under the grid edits the drum and the step you last touched.' },
  { target: '.effects-unit', title: 'Effects', text: 'The effects are shared by the whole rack. Each lane and the drums have sends that set how much of them goes through.' },
  { target: '.transport .rack-menu', title: 'Project and Export', text: 'Project has all your projects, earlier versions, share links and imports. Export downloads the open scene or the whole song as audio or MIDI.' },
  { target: '.account-button', title: 'Your account', text: 'Projects you make while signed in are kept in your account and follow you to any browser you sign in on. This walkthrough can be shown again from here.' },
  { target: '.transport [aria-label="Help"]', title: 'Help', text: 'The ? button explains every control and lists the keyboard shortcuts. That is all you need to start.' },
];

const GAP = 12;
// At this width and below the card sits along the bottom of the screen instead of beside its target.
const NARROW = 640;

interface Placement { spot: CSSProperties | null; card: CSSProperties }

// A tour of the rack: one part is lit at a time and a card explains it. Escape or Skip ends it.
export default function Walkthrough({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement>({ spot: null, card: {} });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const stop = STOPS[index], last = index === STOPS.length - 1;

  const place = useCallback((scroll: boolean) => {
    const width = window.innerWidth, height = window.innerHeight, narrow = width <= NARROW;
    const cardWidth = cardRef.current?.offsetWidth ?? 0, cardHeight = cardRef.current?.offsetHeight ?? 0;
    const alongBottom: CSSProperties = { left: GAP, right: GAP, bottom: GAP, width: 'auto' };
    const targets = Array.from(document.querySelectorAll<HTMLElement>(stop.target)).filter(element => element.getClientRects().length > 0);
    if (targets.length === 0) {
      setPlacement({ spot: null, card: narrow ? alongBottom : { top: Math.max(GAP, (height - cardHeight) / 2), left: Math.max(GAP, (width - cardWidth) / 2) } });
      return;
    }
    const measure = () => {
      const rects = targets.map(element => element.getBoundingClientRect());
      return {
        top: Math.min(...rects.map(rect => rect.top)), bottom: Math.max(...rects.map(rect => rect.bottom)),
        left: Math.min(...rects.map(rect => rect.left)), right: Math.max(...rects.map(rect => rect.right)),
      };
    };
    // The page is the scrolling area and the transport bar stays at its top, over whatever is scrolled under it.
    const page = document.querySelector<HTMLElement>('.rack-page');
    const inBar = targets[0].closest('.rack-unit.transport') !== null;
    const bar = inBar ? 0 : page?.querySelector('.rack-unit.transport')?.getBoundingClientRect().bottom ?? 0;
    let area = measure();
    if (scroll && page) {
      if (!inBar && (area.top < bar + GAP || area.bottom > height - cardHeight - GAP * 2)) page.scrollTop += area.top - bar - GAP;
      if (area.left < GAP || area.right > width - GAP) page.scrollLeft += area.left - GAP;
      area = measure();
    }
    const top = Math.max(area.top - 4, bar), bottom = Math.min(area.bottom + 4, height);
    const below = area.bottom + GAP, above = area.top - GAP - cardHeight;
    setPlacement({
      spot: { top, left: area.left - 4, width: area.right - area.left + 8, height: Math.max(0, bottom - top) },
      card: narrow ? alongBottom : {
        top: below + cardHeight <= height - GAP ? below : above >= bar + GAP ? above : Math.max(GAP, height - cardHeight - GAP),
        left: Math.max(GAP, Math.min(area.left, width - cardWidth - GAP)),
      },
    });
  }, [stop.target]);

  useLayoutEffect(() => {
    place(true);
    nextRef.current?.focus({ preventScroll: true });
  }, [place]);

  useEffect(() => {
    const page = document.querySelector('.rack-page');
    const again = () => place(false);
    window.addEventListener('resize', again);
    page?.addEventListener('scroll', again);
    return () => {
      window.removeEventListener('resize', again);
      page?.removeEventListener('scroll', again);
    };
  }, [place]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // A dialog that closed to make way for the tour has just handed focus back to its button,
    // which also scrolls that button into view. Both are put right here, after it.
    place(true);
    nextRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      else if (event.key === 'ArrowRight') setIndex(current => Math.min(STOPS.length - 1, current + 1));
      else if (event.key === 'ArrowLeft') setIndex(current => Math.max(0, current - 1));
      if (event.key !== 'Tab') return;
      const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') || []);
      const first = items[0], end = items[items.length - 1], active = document.activeElement;
      if (!cardRef.current?.contains(active)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); end?.focus(); }
      else if (!event.shiftKey && active === end) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <>
      <div className={`tour-shade ${placement.spot ? '' : 'dark'}`} role="presentation" />
      {placement.spot && <div className="tour-spot" style={placement.spot} />}
      <div ref={cardRef} className="tour-card" role="dialog" aria-modal="true" aria-label="Walkthrough" style={placement.card}>
        <span className="tour-count">Step {index + 1} of {STOPS.length}</span>
        <h2>{stop.title}</h2>
        <p aria-live="polite">{stop.text}</p>
        <div className="tour-actions">
          {!last && <button className="rack-btn tour-skip" onClick={onClose}>Skip</button>}
          <button className="rack-btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</button>
          <button ref={nextRef} className="rack-btn go" onClick={last ? onClose : () => setIndex(index + 1)}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </>
  );
}
