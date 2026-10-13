import { useState } from 'react';
import type { Scene } from '../types';
import Menu from './Menu';
import ConfirmDialog from './ConfirmDialog';

interface CopyToSceneProps {
  // What is copied, as it is said: "Synth 1's notes", "the Kick row".
  part: string;
  scenes: Scene[];
  currentSceneId: string;
  // Whether a scene already has something where the copy would go.
  filled: (scene: Scene) => boolean;
  onCopy: (sceneId: string) => void;
}

// "Copy to": puts one part of the open scene into another scene, which until this could only be
// copied whole. The copy replaces what the other scene had for that part and cannot be undone, so
// it asks first when there is something there to lose.
export default function CopyToScene({ part, scenes, currentSceneId, filled, onCopy }: CopyToSceneProps) {
  const [asking, setAsking] = useState<Scene | null>(null);
  const others = scenes.filter(scene => scene.id !== currentSceneId);
  const choose = (scene: Scene) => { if (filled(scene)) setAsking(scene); else onCopy(scene.id); };
  return (
    <>
      <Menu
        label="Copy to"
        groups={[others.length > 0
          ? others.map(scene => ({ label: scene.name, title: `Put ${part} into ${scene.name}, in place of what it has there`, onSelect: () => choose(scene) }))
          : [{ label: 'No other scene yet', title: 'Add a scene in the Scenes row first', onSelect: () => {}, disabled: true }]]}
      />
      {asking && (
        <ConfirmDialog
          title={`Copy to ${asking.name}?`}
          confirmLabel="Replace"
          onConfirm={() => { onCopy(asking.id); setAsking(null); }}
          onCancel={() => setAsking(null)}
        >
          {asking.name} already has something there. Copying {part} into it replaces that, and Undo will not bring it back.
        </ConfirmDialog>
      )}
    </>
  );
}
