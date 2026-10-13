import { useState } from 'react';
import { RANDOM_KEYS, RANDOM_SCALES, asRandomChoice, storeRandomChoice, storedRandomChoice, type RandomChoice } from '../services/randomize';

interface RandomizeToolProps {
  synthId: number;
  onRandomize: (choice: RandomChoice) => void;
}

// Randomize: a key, a scale and a button that fills this lane's pattern, in the open scene, with a
// new line in that scale. The key and scale are how the tool is being used, so they are this
// component's own and remembered by the browser, not by the project.
export default function RandomizeTool({ synthId, onRandomize }: RandomizeToolProps) {
  const [choice, setChoice] = useState(storedRandomChoice);
  const choose = (next: Partial<RandomChoice>) => {
    const chosen = asRandomChoice({ ...choice, ...next });
    setChoice(chosen);
    storeRandomChoice(chosen);
  };
  return (
    <span className="randomize-tool" role="group" aria-label={`Synth ${synthId} randomize`}>
      <label>
        Key
        <select aria-label="Randomize key" title="The note the new line starts on and is built around" value={choice.key} onChange={event => choose({ key: event.target.value as RandomChoice['key'] })}>
          {RANDOM_KEYS.map(key => <option key={key} value={key}>{key}</option>)}
        </select>
      </label>
      <label>
        Scale
        <select aria-label="Randomize scale" title="The notes the new line may use" value={choice.scale} onChange={event => choose({ scale: event.target.value as RandomChoice['scale'] })}>
          {Object.entries(RANDOM_SCALES).map(([id, scale]) => <option key={id} value={id}>{scale.name}</option>)}
        </select>
      </label>
      <button
        className="rack-btn"
        aria-label={`Randomize Synth ${synthId}`}
        title="Replace this pattern's notes with a new random line in this key and scale. Undo brings back what was there"
        onClick={() => onRandomize(choice)}
      >
        Randomize
      </button>
    </span>
  );
}
