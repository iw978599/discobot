import { useState } from 'react';
import { SavedPatternInfo } from '../types';
import { localRequest } from '../services/localService';
import Dialog from './Dialog';

interface PatternManagerProps {
  saved: SavedPatternInfo[];
  onLoad: (id: string) => void;
  onChanged: () => void;
  onClose: () => void;
}

export default function PatternManager({ saved, onLoad, onChanged, onClose }: PatternManagerProps) {
  const [error, setError] = useState('');
  const remove = async (id: string) => {
    try {
      const response = await localRequest(`/patterns/saved/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Saved pattern could not be deleted.');
      setError('');
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Saved pattern could not be deleted.');
    }
  };
  return (
    <Dialog title="Saved Patterns" closeLabel="Close saved patterns" onClose={onClose}>
      {error && <p role="alert">{error}</p>}
      {saved.length === 0 && <p className="rack-empty">No saved patterns yet.</p>}
      {saved.map((pattern) => (
        <div key={pattern.id} className="rack-list-row">
          <span>{pattern.name}</span>
          <button className="rack-btn" onClick={() => { onLoad(pattern.id); onClose(); }}>Load</button>
          <button className="rack-btn danger" onClick={() => { void remove(pattern.id); }}>Delete</button>
        </div>
      ))}
    </Dialog>
  );
}
