import type { SequencerStep } from '../types';
import { TRANSPOSE_MOVES, canTranspose } from '../services/transpose';

interface TransposeToolProps {
  synthId: number;
  steps: SequencerStep[];
  onTranspose: (semitones: number) => void;
}

const WORDS: Record<number, string> = { [-12]: 'down an octave', [-1]: 'down a semitone', 1: 'up a semitone', 12: 'up an octave' };
const FACES: Record<number, string> = { [-12]: '−12', [-1]: '−1', 1: '+1', 12: '+12' };

// Transpose: moves every note of this lane's pattern, in the open scene, up or down. A button is
// disabled when there is no note to move, or when the move would carry one out of the notes the
// app can name; the buttons are always there, so the row keeps its shape.
export default function TransposeTool({ synthId, steps, onTranspose }: TransposeToolProps) {
  const empty = !steps.some(step => step.active);
  return (
    <span className="transpose-tool" role="group" aria-label={`Synth ${synthId} transpose`}>
      <span className="transpose-tool-name">Transpose</span>
      {TRANSPOSE_MOVES.map(move => {
        const able = canTranspose(steps, move);
        return (
          <button
            key={move}
            className="rack-btn"
            aria-label={`Transpose Synth ${synthId} ${WORDS[move]}`}
            title={able
              ? `Move every note in this pattern ${WORDS[move]}`
              : empty ? 'There are no notes in this pattern to move' : `A note in this pattern cannot go ${WORDS[move]}: it would be ${move < 0 ? 'below C0' : 'above B8'}`}
            disabled={!able}
            onClick={() => onTranspose(move)}
          >
            {FACES[move]}
          </button>
        );
      })}
    </span>
  );
}
