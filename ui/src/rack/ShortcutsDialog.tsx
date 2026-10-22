import { useRef, useState } from 'react';
import Dialog from './Dialog';
import { SHORTCUT_GROUPS, findShortcuts } from '../services/shortcuts';

// Every shortcut the app has (services/shortcuts.ts), in groups, with a search that keeps the
// ones every word typed is found in. Opened with Shift + ? anywhere but a text field, and from Help.
export default function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const found = findShortcuts(query);
  const count = found.reduce((total, group) => total + group.shortcuts.length, 0);
  const all = SHORTCUT_GROUPS.reduce((total, group) => total + group.shortcuts.length, 0);
  return (
    <Dialog title="Keyboard Shortcuts" closeLabel="Close shortcuts" onClose={onClose} initialFocus="#shortcut-search">
      <div className="account-field help-search">
        <label htmlFor="shortcut-search">Search shortcuts</label>
        <div className="help-search-row">
          <input ref={searchRef} id="shortcut-search" type="text" value={query} autoComplete="off" spellCheck={false} enterKeyHint="search" onChange={(event) => setQuery(event.target.value)} />
          <button className="rack-btn" aria-label="Clear search" disabled={!query} onClick={() => { setQuery(''); searchRef.current?.focus(); }}>Clear</button>
        </div>
        <p className="help-count" role="status">{query.trim() ? `${count} of ${all} shortcuts` : `${all} shortcuts`}</p>
      </div>
      <div className="shortcut-groups">
        {found.map(group => (
          <section key={group.title} aria-label={group.title}>
            <h3>{group.title}</h3>
            <dl className="shortcut-list">
              {group.shortcuts.map(shortcut => (
                <div key={`${shortcut.keys.join('+')}:${shortcut.does}`} className="shortcut-row">
                  <dt>
                    {shortcut.keys.map((combination, index) => (
                      <span key={index} className="shortcut-keys">
                        {/* Two ways are "this or that"; a row of letters is just the row. */}
                        {index > 0 && shortcut.keys.length === 2 && <span className="shortcut-or">or</span>}
                        {combination.split(' + ').map((key, at) => <span key={at}>{at > 0 && '+'}<kbd>{key}</kbd></span>)}
                      </span>
                    ))}
                  </dt>
                  <dd>{shortcut.does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {count === 0 && <p className="rack-empty">No shortcut has all of those words.</p>}
      </div>
    </Dialog>
  );
}
