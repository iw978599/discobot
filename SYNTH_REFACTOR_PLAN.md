# Synth Architecture Refactor - Implementation Plan

## Overview

Refactor the synthesizer UI to support multiple independent synth units (max 2), each with its own sequencer, keyboard with octave controls, and parameter settings. Rearrange layout for better workflow.

## Goals

1. **Combine** Keyboard + Sequencer + SynthControls into unified "SynthUnit" components
2. **Support 1-2 independent synths**, each with:
   - 16-step sequencer (top section, left side)
   - Synth parameter knobs (top section, right side)
   - Full-width 3-octave keyboard with octave shift controls (bottom)
3. **Layout**: Synth units stacked vertically, drum machine at bottom (full width)
4. **Backend**: Support multiple independent synthesizer instances

## Target Layout

```
┌────────────────────────────────────────────────────────┐
│  Synth 1                            [+ Add Synth 2]    │
│  ┌────────────────────────────────┐ ┌──────────────┐  │
│  │   16-Step Sequencer            │ │ Synth Knobs  │  │
│  │   [Play] [Stop] [BPM: 120]     │ │ (Oscillator) │  │
│  │   ████░░░░░░░░░░░░░░░░          │ │ (Filter)     │  │
│  └────────────────────────────────┘ │ (Envelope)   │  │
│                                      │ (Effects)    │  │
│  ┌─────────────────────────────────┴──────────────┐  │
│  │  [Oct -]   3-Octave Keyboard (C3-B5)   [Oct +] │  │
│  │  C C# D D# E F F# G G# A A# B ... (36 keys)    │  │
│  └────────────────────────────────────────────────┘  │
├────────────────────────────────────────────────────────┤
│  Synth 2                            [× Remove]         │
│  (identical layout to Synth 1)                         │
├────────────────────────────────────────────────────────┤
│  Drum Machine (existing component, full width)         │
└────────────────────────────────────────────────────────┘
```

---

## Phase 1: Frontend Component Structure

### 1.1 Create `SynthUnit.tsx` Component

**Location**: `ui/src/components/SynthUnit.tsx`

**Purpose**: Encapsulates one complete synthesizer (sequencer, controls, keyboard)

**Props Interface**:
```typescript
interface SynthUnitProps {
  synthId: number;                    // 1 or 2
  pattern: Pattern;                   // Current pattern for this synth
  synthParams: SynthParameters;       // Synth settings
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  octaveShift: number;                // -1, 0, or +1
  showRemoveButton: boolean;          // Only show on synth 2
  onStepToggle: (step: number) => void;
  onNoteChange: (step: number, note: string | null) => void;
  onVelocityChange: (step: number, velocity: number) => void;
  onParameterChange: (params: Partial<SynthParameters>) => void;
  onOctaveShift: (direction: 'up' | 'down') => void;
  onRemove?: () => void;              // Callback to remove synth 2
  onPlayNote: (note: string) => void; // For keyboard clicks
}
```

**Component Structure**:
```tsx
export default function SynthUnit({
  synthId,
  pattern,
  synthParams,
  isPlaying,
  currentStep,
  selectedStep,
  octaveShift,
  showRemoveButton,
  onStepToggle,
  onNoteChange,
  onVelocityChange,
  onParameterChange,
  onOctaveShift,
  onRemove,
  onPlayNote,
}: SynthUnitProps) {
  return (
    <div className="synth-unit">
      <div className="synth-unit-header">
        <h2>Synth {synthId}</h2>
        {showRemoveButton && (
          <button className="remove-synth-btn" onClick={onRemove}>
            × Remove
          </button>
        )}
      </div>

      <div className="synth-unit-top">
        {/* Left: Sequencer */}
        <div className="synth-unit-sequencer">
          <Sequencer
            pattern={pattern}
            isPlaying={isPlaying}
            currentStep={currentStep}
            selectedStep={selectedStep}
            onStepToggle={onStepToggle}
            onNoteChange={onNoteChange}
            onVelocityChange={onVelocityChange}
          />
        </div>

        {/* Right: Synth Controls */}
        <div className="synth-unit-controls">
          <SynthControls
            parameters={synthParams}
            onParameterChange={onParameterChange}
          />
        </div>
      </div>

      {/* Bottom: Full-width Keyboard with octave controls */}
      <div className="synth-unit-keyboard-container">
        <button 
          className="octave-shift-btn"
          onClick={() => onOctaveShift('down')}
          disabled={octaveShift <= -1}
          title="Shift octave down"
        >
          Oct -
        </button>
        
        <Keyboard 
          onNotePlay={onPlayNote}
          octaveShift={octaveShift}
        />
        
        <button 
          className="octave-shift-btn"
          onClick={() => onOctaveShift('up')}
          disabled={octaveShift >= 1}
          title="Shift octave up"
        >
          Oct +
        </button>
      </div>
    </div>
  );
}
```

**CSS File**: `ui/src/components/SynthUnit.css`

```css
.synth-unit {
  background: #1a1a1a;
  border: 2px solid #333;
  border-radius: 8px;
  padding: 20px;
  margin-bottom: 20px;
}

.synth-unit-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.synth-unit-header h2 {
  margin: 0;
  color: #00d4ff;
  font-size: 1.5rem;
}

.remove-synth-btn {
  background: #ff4444;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 1rem;
}

.remove-synth-btn:hover {
  background: #ff6666;
}

.synth-unit-top {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.synth-unit-sequencer {
  flex: 2;
  min-width: 0;
}

.synth-unit-controls {
  flex: 1;
  min-width: 300px;
}

.synth-unit-keyboard-container {
  display: flex;
  align-items: center;
  gap: 16px;
  background: #0a0a0a;
  padding: 16px;
  border-radius: 8px;
}

.synth-unit-keyboard-container .keyboard {
  flex: 1;
}

.octave-shift-btn {
  background: #333;
  color: #00d4ff;
  border: 2px solid #00d4ff;
  padding: 12px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: bold;
  transition: all 0.2s;
}

.octave-shift-btn:hover:not(:disabled) {
  background: #00d4ff;
  color: #000;
}

.octave-shift-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
```

---

### 1.2 Update `Keyboard.tsx` Component

**Add octave shift support**:

**Location**: `ui/src/components/Keyboard.tsx`

**Changes**:

1. Add `octaveShift` prop (number: -1, 0, or +1)
2. Modify `NOTES` array generation based on octave shift
3. Update displayed note names

**Implementation**:

```typescript
interface KeyboardProps {
  onNotePlay: (note: string) => void;
  octaveShift?: number; // -1, 0, +1 (default: 0)
}

export default function Keyboard({ onNotePlay, octaveShift = 0 }: KeyboardProps) {
  // Base octaves: 3, 4, 5 (C3 to B5)
  // With shift: adjust range
  const baseOctave = 3 + octaveShift; // Shift: -1 → octave 2-4, 0 → 3-5, +1 → 4-6
  
  // Generate notes for 3 octaves starting from baseOctave
  const NOTES = [
    ...generateOctaveNotes(baseOctave),
    ...generateOctaveNotes(baseOctave + 1),
    ...generateOctaveNotes(baseOctave + 2),
  ];

  // Rest of keyboard implementation...
  // Update visual labels to show current octave range
}

function generateOctaveNotes(octave: number): string[] {
  return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
    .map(note => `${note}${octave}`);
}
```

**Display current octave range**:
```tsx
<div className="keyboard-header">
  <span className="keyboard-range">
    {NOTES[0]} - {NOTES[NOTES.length - 1]}
  </span>
</div>
```

---

### 1.3 Update `App.tsx` - State Management

**Add state for multiple synths**:

```typescript
interface SynthState {
  id: number;
  pattern: Pattern;
  synthParams: SynthParameters;
  isPlaying: boolean;
  currentStep: number;
  selectedStep: number | null;
  octaveShift: number;
}

function App() {
  // Replace single pattern/params with array of synth states
  const [synths, setSynths] = useState<SynthState[]>([
    {
      id: 1,
      pattern: null, // Will be set from server
      synthParams: DEFAULT_PARAMS,
      isPlaying: false,
      currentStep: 0,
      selectedStep: null,
      octaveShift: 0,
    }
  ]);

  const [drumState, setDrumState] = useState<DrumState>(defaultDrumState);
  // ... rest of state
}
```

**Add synth management functions**:

```typescript
const handleAddSynth = useCallback(() => {
  if (synths.length >= 2) return; // Max 2 synths
  
  setSynths(prev => [...prev, {
    id: 2,
    pattern: createEmptyPattern('Synth 2'),
    synthParams: DEFAULT_PARAMS,
    isPlaying: false,
    currentStep: 0,
    selectedStep: null,
    octaveShift: 0,
  }]);

  // Tell server to create second synth
  fetch(apiUrl('/synth/create'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ synthId: 2 }),
  });
}, [synths.length]);

const handleRemoveSynth = useCallback((synthId: number) => {
  setSynths(prev => prev.filter(s => s.id !== synthId));
  
  // Tell server to remove synth
  fetch(apiUrl(`/synth/${synthId}`), { method: 'DELETE' });
}, []);

const handleOctaveShift = useCallback((synthId: number, direction: 'up' | 'down') => {
  setSynths(prev => prev.map(s => {
    if (s.id !== synthId) return s;
    
    const newShift = direction === 'up' 
      ? Math.min(s.octaveShift + 1, 1)  // Max +1
      : Math.max(s.octaveShift - 1, -1); // Min -1
    
    return { ...s, octaveShift: newShift };
  }));
}, []);
```

**Render synth units**:

```tsx
return (
  <div className="app">
    <header className="app-header">
      <h1>Discord Synth Bot</h1>
      <button onClick={handleMuteToggle}>
        {browserMuted ? '🔇 Unmute' : '🔊 Mute'}
      </button>
    </header>

    <div className="app-content">
      {/* Synth Units */}
      <div className="synth-units-container">
        {synths.map(synth => (
          <SynthUnit
            key={synth.id}
            synthId={synth.id}
            pattern={synth.pattern}
            synthParams={synth.synthParams}
            isPlaying={synth.isPlaying}
            currentStep={synth.currentStep}
            selectedStep={synth.selectedStep}
            octaveShift={synth.octaveShift}
            showRemoveButton={synth.id === 2}
            onStepToggle={(step) => handleStepToggle(synth.id, step)}
            onNoteChange={(step, note) => handleNoteChange(synth.id, step, note)}
            onVelocityChange={(step, vel) => handleVelocityChange(synth.id, step, vel)}
            onParameterChange={(params) => handleParameterChange(synth.id, params)}
            onOctaveShift={(dir) => handleOctaveShift(synth.id, dir)}
            onRemove={synth.id === 2 ? () => handleRemoveSynth(2) : undefined}
            onPlayNote={(note) => handlePlayNote(synth.id, note)}
          />
        ))}

        {synths.length < 2 && (
          <button className="add-synth-btn" onClick={handleAddSynth}>
            + Add Synth 2
          </button>
        )}
      </div>

      {/* Drum Machine */}
      <DrumMachine
        drumState={drumState}
        isPlaying={isPlaying}
        currentStep={currentStep}
        onStepToggle={handleDrumStepToggle}
        onSettingsChange={handleDrumSettingsChange}
        onReset={handleDrumReset}
        drumMasterVolume={drumMasterVolume}
        onMasterVolumeChange={handleDrumMasterVolumeChange}
        drumAudio={drumAudio}
      />
    </div>
  </div>
);
```

**Update App.css**:

```css
.synth-units-container {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto 20px;
}

.add-synth-btn {
  width: 100%;
  padding: 20px;
  background: #2a2a2a;
  border: 2px dashed #00d4ff;
  border-radius: 8px;
  color: #00d4ff;
  font-size: 1.2rem;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.2s;
}

.add-synth-btn:hover {
  background: #333;
  border-style: solid;
}
```

---

## Phase 2: Backend Changes

### 2.1 Update `web/src/index.ts` - Multiple Synth Support

**Current**: Single global `synth`, `sequencer`, `pattern`

**New**: Map of synths by ID

```typescript
// Replace single synth with map
const synths = new Map<number, {
  synth: Synthesizer;
  sequencer: Sequencer;
  pattern: Pattern;
}>();

const patterns = new Map<string, Pattern>(); // Keep for persistence
let drumState: DrumState = createDefaultDrumState();

// Initialize first synth on startup
function initSynth(synthId: number) {
  if (synths.has(synthId)) return;
  
  const synth = new Synthesizer();
  const sequencer = new Sequencer(synth);
  const pattern = sequencer.createEmptyPattern(`Synth ${synthId}`);
  
  sequencer.onStep((step: number) => {
    broadcastToClients({
      type: 'sequencerStep',
      data: { synthId, step },
    });
  });

  synths.set(synthId, { synth, sequencer, pattern });
  patterns.set(pattern.id, pattern);
}

// Initialize synth 1 by default
initSynth(1);
```

**Update API endpoints to accept `synthId` parameter**:

```typescript
// Create new synth
app.post('/synth/create', (req, res) => {
  const { synthId } = req.body;
  
  if (!synthId || synths.has(synthId)) {
    return res.status(400).json({ error: 'Invalid synthId' });
  }
  
  initSynth(synthId);
  const synthData = synths.get(synthId)!;
  
  res.json({
    synthId,
    pattern: synthData.pattern,
    synthParams: synthData.synth.getParameters(),
  });
});

// Delete synth
app.delete('/synth/:synthId', (req, res) => {
  const synthId = parseInt(req.params.synthId);
  
  if (synthId === 1) {
    return res.status(400).json({ error: 'Cannot remove synth 1' });
  }
  
  const synthData = synths.get(synthId);
  if (synthData) {
    synthData.sequencer.stop();
    synths.delete(synthId);
  }
  
  res.json({ success: true });
});

// Update synth parameters (add synthId to body or URL)
app.post('/synth/:synthId/parameters', (req, res) => {
  const synthId = parseInt(req.params.synthId);
  const synthData = synths.get(synthId);
  
  if (!synthData) {
    return res.status(404).json({ error: 'Synth not found' });
  }
  
  synthData.synth.updateParameters(req.body);
  
  broadcastToClients({
    type: 'synthUpdate',
    data: { synthId, parameters: synthData.synth.getParameters() },
  });
  
  res.json({ success: true });
});

// Play note (add synthId)
app.post('/synth/:synthId/note', (req, res) => {
  const synthId = parseInt(req.params.synthId);
  const { note, duration, velocity } = req.body;
  const synthData = synths.get(synthId);
  
  if (!synthData) {
    return res.status(404).json({ error: 'Synth not found' });
  }
  
  synthData.synth.playNote(note, duration || 0.2, velocity || 0.8);
  res.json({ success: true });
});

// Update patterns endpoints similarly
app.post('/patterns', (req, res) => {
  const { synthId, name } = req.body;
  const synthData = synths.get(synthId || 1);
  
  if (!synthData) {
    return res.status(404).json({ error: 'Synth not found' });
  }
  
  const pattern = synthData.sequencer.createEmptyPattern(name);
  patterns.set(pattern.id, pattern);
  synthData.pattern = pattern;
  
  broadcastToClients({
    type: 'patternCreated',
    data: { synthId, pattern },
  });
  
  res.json(pattern);
});

// Similar updates for:
// - POST /patterns/:id/step/:step
// - POST /sequencer/play
// - POST /sequencer/stop
// - POST /sequencer/tempo
// All should accept synthId to target correct synth
```

**Update WebSocket init message**:

```typescript
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('WebSocket client connected');

  // Send all synths
  const synthsData = Array.from(synths.entries()).map(([id, data]) => ({
    synthId: id,
    pattern: data.pattern,
    synthParams: data.synth.getParameters(),
    isPlaying: data.sequencer.getIsPlaying(),
  }));

  ws.send(JSON.stringify({
    type: 'init',
    data: {
      hasActiveSession,
      synths: synthsData,
      samples: samplePlayer!.getSamples(),
      drumState,
    },
  }));
  
  // ... rest of connection handler
});
```

---

### 2.2 Update WebSocket Message Types

**Add synthId to relevant messages**:

```typescript
// Client → Server messages already go via HTTP endpoints with synthId in URL

// Server → Client messages:
type WSMessage = 
  | { type: 'init'; data: { synths: SynthData[]; drumState: DrumState; ... } }
  | { type: 'synthUpdate'; data: { synthId: number; parameters: SynthParameters } }
  | { type: 'patternCreated'; data: { synthId: number; pattern: Pattern } }
  | { type: 'patternUpdated'; data: { synthId: number; pattern: Pattern } }
  | { type: 'sequencerPlay'; data: { synthId: number } }
  | { type: 'sequencerStop'; data: { synthId: number } }
  | { type: 'sequencerStep'; data: { synthId: number; step: number } }
  | { type: 'drumStep'; data: { instrument: string; step: number; active: boolean } }
  // ... etc
```

**Update frontend WebSocket handler** in `App.tsx`:

```typescript
const handleMessage = useCallback((message: any) => {
  switch (message.type) {
    case 'init':
      // Initialize synths from server data
      if (message.data.synths) {
        setSynths(message.data.synths.map((s: any) => ({
          id: s.synthId,
          pattern: s.pattern,
          synthParams: s.synthParams,
          isPlaying: s.isPlaying,
          currentStep: 0,
          selectedStep: null,
          octaveShift: 0,
        })));
      }
      if (message.data.drumState) setDrumState(message.data.drumState);
      break;

    case 'synthUpdate':
      setSynths(prev => prev.map(s =>
        s.id === message.data.synthId
          ? { ...s, synthParams: message.data.parameters }
          : s
      ));
      break;

    case 'sequencerPlay':
      setSynths(prev => prev.map(s =>
        s.id === message.data.synthId
          ? { ...s, isPlaying: true }
          : s
      ));
      break;

    case 'sequencerStop':
      setSynths(prev => prev.map(s =>
        s.id === message.data.synthId
          ? { ...s, isPlaying: false, currentStep: 0 }
          : s
      ));
      break;

    case 'sequencerStep': {
      const { synthId, step } = message.data;
      setSynths(prev => prev.map(s => {
        if (s.id !== synthId) return s;
        
        // Play note if step has one
        if (s.pattern?.steps[step]?.note) {
          synthAudio.playNote(
            s.pattern.steps[step].note!,
            s.synthParams,
            0.15,
            browserMutedRef.current
          );
        }
        
        return { ...s, currentStep: step };
      }));
      break;
    }

    // ... drum cases remain the same
  }
}, [synthAudio]);
```

---

## Phase 3: Audio Playback Updates

### 3.1 Update `useSynthAudio.ts`

**If needed**, ensure it can handle multiple synth parameters:

```typescript
// Current implementation should work fine, just verify:
// - playNote accepts synthParams as argument ✓
// - Each synth unit passes its own synthParams ✓
// No changes needed to hook itself
```

---

## Phase 4: Testing Checklist

### 4.1 Single Synth Mode
- [ ] Sequencer displays and plays correctly
- [ ] Keyboard plays notes
- [ ] Octave shift buttons work (Oct-, Oct+)
- [ ] Octave range displays correctly (e.g., "C3 - B5", "C4 - B6")
- [ ] Synth controls update parameters
- [ ] Parameter changes affect sound
- [ ] Play/Stop works
- [ ] Step programming works

### 4.2 Dual Synth Mode
- [ ] "Add Synth 2" button appears and works
- [ ] Synth 2 appears below Synth 1
- [ ] Both synths are independent (separate patterns, parameters, octaves)
- [ ] Both keyboards work independently
- [ ] Both sequencers play independently
- [ ] Remove button on Synth 2 works
- [ ] Server maintains separate synth instances

### 4.3 Integration
- [ ] Drum machine still works
- [ ] Layout is responsive and looks good
- [ ] WebSocket sync works for both synths
- [ ] Discord bot can still trigger both synths
- [ ] Audio doesn't clip with 2 synths + drums playing

### 4.4 Edge Cases
- [ ] Cannot add more than 2 synths
- [ ] Cannot remove Synth 1
- [ ] Octave shift disabled at limits (-1, +1)
- [ ] Adding/removing synth doesn't crash
- [ ] Page refresh preserves synth count and state

---

## Phase 5: Deployment Notes

### 5.1 Migration
- Existing single-synth users will see Synth 1 only
- Pattern data should migrate seamlessly
- If server restart needed, coordinate with users

### 5.2 Performance
- Two synths + drums = 3 audio sources
- Monitor CPU usage in browser AudioContext
- Consider adding master limiter if clipping occurs

### 5.3 Future Enhancements
- Pattern copy between synths
- Sync/link playback between synths
- Mute/solo per synth
- Save synth presets
- More than 2 synths (if performance allows)

---

## File Checklist

### New Files
- [ ] `ui/src/components/SynthUnit.tsx`
- [ ] `ui/src/components/SynthUnit.css`

### Modified Files
- [ ] `ui/src/App.tsx` (major refactor - state management)
- [ ] `ui/src/App.css` (layout updates)
- [ ] `ui/src/components/Keyboard.tsx` (octave shift)
- [ ] `ui/src/components/Keyboard.css` (octave buttons)
- [ ] `web/src/index.ts` (multi-synth backend)
- [ ] `ui/src/hooks/useWebSocket.ts` (might need type updates)
- [ ] `ui/src/types.ts` (if SynthState interface added)

### Files to Review (may need minor updates)
- [ ] `ui/src/components/Sequencer.tsx`
- [ ] `ui/src/components/SynthControls.tsx`
- [ ] `ui/src/hooks/useSynthAudio.ts`

---

## Implementation Order

1. ✅ **Create this document**
2. Create `SynthUnit` component (frontend shell)
3. Add octave shift to `Keyboard` component
4. Update `App.tsx` state management (single synth first)
5. Test single synth in new layout
6. Add backend multi-synth support
7. Add frontend add/remove synth logic
8. Test dual synth mode
9. Update WebSocket messages for multi-synth
10. Update CSS for final layout
11. Test everything end-to-end
12. Deploy to Railway

---

## Code Review Points

- Ensure no memory leaks (AudioContext cleanup)
- Verify WebSocket message types are correct
- Check CSS responsiveness on different screen sizes
- Validate synthId in all API endpoints
- Ensure octave shift state persists correctly
- Check keyboard note generation edge cases

---

## Questions to Resolve Before Implementation

1. Should octave shift state persist across page refresh? (Recommendation: No, default to 0)
2. Should both synths share the same tempo/BPM? (Recommendation: Yes, global tempo)
3. What happens if user creates Synth 2, removes it, then adds it again? (Recommendation: Fresh state)
4. Should we add a "Copy Pattern from Synth 1 to Synth 2" feature? (Recommendation: Future enhancement)

---

## Success Criteria

✅ User can add up to 2 independent synthesizers
✅ Each synth has its own sequencer, keyboard, and controls
✅ Octave shift works (+1/-1 octave range)
✅ Layout is clean and intuitive
✅ Performance is acceptable with 2 synths + drums
✅ All existing functionality still works
✅ Code is maintainable and well-documented

---

**Estimated Implementation Time**: 6-8 hours for experienced developer, 10-15 hours for AI agent (depending on debugging)

**Complexity**: High (major refactor touching frontend, backend, and state management)

**Risk Level**: Medium (existing functionality must continue working)

---

_Document created: 2026-07-10_
_Last updated: 2026-07-10_
_Author: Claude Sonnet 4.5_
