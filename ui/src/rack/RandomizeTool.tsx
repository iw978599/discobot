import { useSyncExternalStore } from 'react';
import { RANDOM_KEYS, RANDOM_SCALES, type RandomChoice } from '../services/randomize';
import { scaleLock } from '../services/scaleLock';

interface RandomizeToolProps {
  synthId: number;
  onRandomize: (choice: RandomChoice) => void;
}

// Randomize: a key, a scale and a button that fills this lane's pattern, in the open scene, with a
// new line in that scale; and the scale lock, which holds every lane's keys, piano roll and chords
// to the same key and scale. The key, the scale and the lock are how the tools are being used, so
// they are this browser's (`scaleLock.ts`), shared by every lane, and not the project's.
export default function RandomizeTool({ synthId, onRandomize }: RandomizeToolProps) {
  const choice = useSyncExternalStore(scaleLock.subscribe, scaleLock.get);
  return (
    <span className="randomize-tool" role="group" aria-label={`Synth ${synthId} randomize`}>
      <label>
        Key
        <select aria-label="Randomize key" title="The note the new line starts on and is built around, and the key of the scale lock" value={choice.key} onChange={event => scaleLock.choose({ key: event.target.value as RandomChoice['key'] })}>
          {RANDOM_KEYS.map(key => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>
      <label>
        Scale
        <select aria-label="Randomize scale" title="The notes the new line may use, and the notes the scale lock keeps to" value={choice.scale} onChange={event => scaleLock.choose({ scale: event.target.value as RandomChoice['scale'] })}>
          {Object.entries(RANDOM_SCALES).map(([id, scale]) => <option key={id} value={id}>{scale.name}</option>)}
        </select>
      </label>
      <button
        className={`rack-btn ${choice.locked ? 'on' : ''}`}
        aria-pressed={choice.locked}
        aria-label="Scale lock"
        title="Keep every lane to this key and scale: a key played sounds as the nearest note in it, the piano roll takes notes only in it, and the chord menu has chords in it"
        onClick={() => scaleLock.setLocked(!choice.locked)}
      >
        Lock
      </button>
      <button
        className="rack-btn"
        aria-label={`Randomize Synth ${synthId}`}
        title="Replace this pattern's notes with a new random line in this key and scale. Undo brings back what was there"
        onClick={() => onRandomize({ key: choice.key, scale: choice.scale })}
      >
        Randomize
      </button>
    </span>
  );
}
