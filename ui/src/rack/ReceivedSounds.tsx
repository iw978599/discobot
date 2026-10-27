import { useEffect, useRef, useSyncExternalStore } from 'react';
import { EXTRA_DRUMS } from '@discobot/engine';
import type { Studio } from '../studio/useStudio';
import type { DrumRow } from '../types';
import { DRUM_ROWS, DRUM_ROW_NAMES, shownDrumRows } from '../services/drumKits';
import { receiveFromOpener, soundInbox } from '../services/receiveSounds';
import KitImportDialog from './KitImportDialog';

// Drum sounds another app sent (docs/SEND_PROTOCOL.md), shown in Import Kit's dialog. The page
// that opened this one is told `ready` once the studio has its project and this can show them.
export default function ReceivedSounds({ studio }: { studio: Studio }) {
  const offer = useSyncExternalStore(soundInbox.subscribe, soundInbox.current);
  const ready = Boolean(studio.projectId);
  useEffect(() => { if (ready) receiveFromOpener(); }, [ready]);
  const kept = useRef(0);
  if (!offer) return null;
  const added = shownDrumRows(studio.drumState as unknown as Partial<Record<DrumRow, unknown>>).length - DRUM_ROWS.length;
  return (
    <KitImportDialog
      key={offer.files.map(file => file.name).join('\n')}
      files={offer.files}
      picked={offer.picked}
      initial={offer.initial}
      source={`${offer.from} (${offer.site})`}
      lanes={DRUM_ROWS.map(id => ({ id, label: DRUM_ROW_NAMES[id] }))}
      onApply={(lane, sampleId) => studio.handleDrumSampleChange(lane, sampleId)}
      freeRows={EXTRA_DRUMS.length - added}
      onAddRow={studio.handleAddDrumRow}
      onImported={(count) => { kept.current = count; }}
      onClose={() => { const count = kept.current; kept.current = 0; soundInbox.finish(count); }}
    />
  );
}
