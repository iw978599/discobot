import { useState, useEffect } from 'react';
import { Pattern, SavedPatternInfo, SavedPatternFull } from '../types';
import { authFetch } from '../authClient';
import './Sequencer.css';

interface SequencerProps {
  pattern: Pattern | null;
  patterns: Pattern[];
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  onPatternChange: (pattern: Pattern) => void;
  onStepChange: (stepIndex: number) => void;
  onSavePattern: (name: string) => Promise<boolean>;
  onLoadSavedPattern: (data: SavedPatternFull) => void;
}

function PatternManager({
  saved,
  onLoad,
  onDelete,
  onClose,
}: {
  saved: SavedPatternInfo[];
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Saved Patterns</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {saved.length === 0 && <p className="empty-msg">No saved patterns yet.</p>}
          {saved.map((p) => (
            <div key={p.id} className="saved-pattern-row">
              <span className="saved-pattern-name">{p.name}</span>
              <div className="saved-pattern-actions">
                <button className="btn-small btn-load" onClick={() => { onLoad(p.id); onClose(); }}>
                  Load
                </button>
                <button className="btn-small btn-delete" onClick={() => onDelete(p.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Sequencer({
  pattern,
  patterns,
  isPlaying,
  currentStep,
  selectedStep,
  onPatternChange,
  onStepChange,
  onLoadSavedPattern,
}: SequencerProps) {
  const [savedPatterns, setSavedPatterns] = useState<SavedPatternInfo[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [showManager, setShowManager] = useState(false);

  const fetchSaved = async () => {
    try {
      const res = await authFetch('/patterns/saved');
      if (res.ok) setSavedPatterns(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchSaved(); }, []);

  const displayList = showAll ? savedPatterns : savedPatterns.slice(0, 5);

  const handleSelectSaved = async (id: string) => {
    if (!id) return;
    try {
      const res = await authFetch(`/patterns/saved/${id}`);
      if (res.ok) {
        const data: SavedPatternFull = await res.json();
        onLoadSavedPattern(data);
      }
    } catch { /* ignore */ }
  };

  const handleDeleteSaved = async (id: string) => {
    try {
      await authFetch(`/patterns/saved/${id}`, { method: 'DELETE' });
      fetchSaved();
    } catch { /* ignore */ }
  };

  if (!pattern) {
    return <div className="sequencer">Loading...</div>;
  }

  return (
    <div className="sequencer">
      <div className="sequencer-header">
        <h2>Sequencer</h2>
        <div className="sequencer-controls">
          <select
            value={pattern.id}
            onChange={(e) => {
              const selected = patterns.find((p) => p.id === e.target.value);
              if (selected) onPatternChange(selected);
            }}
          >
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="sequencer-grid">
        {pattern.steps.map((step, index) => (
          <div key={index} className="sequencer-column">
            <div className="step-indicator">
              <span
                className={`${currentStep === index && isPlaying ? 'active' : ''}`}
              >
                {index + 1}
              </span>
            </div>
            <button
              className={`step-button ${step.note ? 'has-note' : ''} ${
                selectedStep === index ? 'selected' : ''
              }`}
              onClick={() => onStepChange(index)}
            >
              {step.note || ''}
            </button>
            <div className={`step-light ${currentStep === index && isPlaying ? 'on' : ''}`} />
          </div>
        ))}
      </div>

      <div className="sequencer-info">
        <div className="saved-patterns-bar">
          {savedPatterns.length > 0 && (
            <div className="saved-select-wrapper">
              <select
                className="saved-select"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) handleSelectSaved(e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>Load saved...</option>
                {displayList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {!showAll && savedPatterns.length > 5 && (
                <button className="show-more-btn" onClick={() => setShowAll(true)}>
                  +{savedPatterns.length - 5} more
                </button>
              )}
              {showAll && savedPatterns.length > 5 && (
                <button className="show-more-btn" onClick={() => setShowAll(false)}>
                  Show less
                </button>
              )}
            </div>
          )}

          {savedPatterns.length > 0 && (
            <button className="manage-btn" onClick={() => setShowManager(true)}>
              Manage
            </button>
          )}
        </div>

        <div className="info-right">
          {selectedStep !== null && (
            <span className="step-hint">Step {selectedStep + 1} selected</span>
          )}
        </div>
      </div>

      {showManager && (
        <PatternManager
          saved={savedPatterns}
          onLoad={handleSelectSaved}
          onDelete={handleDeleteSaved}
          onClose={() => { setShowManager(false); fetchSaved(); }}
        />
      )}
    </div>
  );
}
