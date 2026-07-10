import { useState, useRef, useEffect } from 'react';
import { Pattern, SavedPatternInfo, SavedPatternFull } from '../types';
import './Sequencer.css';

interface SequencerProps {
  pattern: Pattern | null;
  patterns: Pattern[];
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  onPlayStop: () => void;
  onPatternChange: (pattern: Pattern) => void;
  onStepChange: (stepIndex: number) => void;
  onTempoChange: (bpm: number) => void;
  onSavePattern: (name: string) => void;
  onLoadSavedPattern: (data: SavedPatternFull) => void;
}

function TempoDisplay({ tempo, onChange }: { tempo: number; onChange: (bpm: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(tempo));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setValue(String(tempo));
  }, [tempo, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const bpm = parseInt(value, 10);
    if (!isNaN(bpm) && bpm >= 20 && bpm <= 400) {
      onChange(bpm);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="tempo-led-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
        autoFocus
      />
    );
  }

  return (
    <div className="tempo-led" onClick={() => setEditing(true)}>
      <span className="tempo-led-label">BPM</span>
      <span className="tempo-led-value">{String(tempo).padStart(3, ' ')}</span>
    </div>
  );
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
  onPlayStop,
  onPatternChange,
  onStepChange,
  onTempoChange,
  onSavePattern,
  onLoadSavedPattern,
}: SequencerProps) {
  const [savedPatterns, setSavedPatterns] = useState<SavedPatternInfo[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showManager, setShowManager] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const fetchSaved = async () => {
    try {
      const res = await fetch('http://localhost:3001/patterns/saved');
      if (res.ok) setSavedPatterns(await res.json());
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchSaved(); }, []);

  const displayList = showAll ? savedPatterns : savedPatterns.slice(0, 5);

  const handleSelectSaved = async (id: string) => {
    if (!id) return;
    try {
      const res = await fetch(`http://localhost:3001/patterns/saved/${id}`);
      if (res.ok) {
        const data: SavedPatternFull = await res.json();
        onLoadSavedPattern(data);
      }
    } catch { /* ignore */ }
  };

  const handleDeleteSaved = async (id: string) => {
    try {
      await fetch(`http://localhost:3001/patterns/saved/${id}`, { method: 'DELETE' });
      fetchSaved();
    } catch { /* ignore */ }
  };

  const handleSaveClick = () => {
    setSaving(true);
    setSaveName('');
  };

  const handleSaveCommit = () => {
    const name = saveName.trim();
    if (!name) { setSaving(false); return; }
    onSavePattern(name);
    setSaving(false);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2000);
    setTimeout(fetchSaved, 200);
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
          <button onClick={onPlayStop} className="play-button">
            {isPlaying ? '⏸ Pause' : '▶ Play'}
          </button>
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
          {savedFeedback ? (
            <span className="save-feedback">&#10003; Saved!</span>
          ) : saving ? (
            <div className="save-inline">
              <input
                autoFocus
                className="save-name-input"
                placeholder="Pattern name..."
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveCommit();
                  if (e.key === 'Escape') setSaving(false);
                }}
              />
              <button className="save-confirm-btn" onClick={handleSaveCommit}>&#10003;</button>
              <button className="save-cancel-btn" onClick={() => setSaving(false)}>&#10005;</button>
            </div>
          ) : (
            <button className="save-button" onClick={handleSaveClick}>
              + Save
            </button>
          )}

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
          <TempoDisplay tempo={pattern.tempo} onChange={onTempoChange} />
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