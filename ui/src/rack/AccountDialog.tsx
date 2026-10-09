import { useEffect, useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { account, currentUser, subscribeAccount, type Invite, type Member } from '../services/account';
import { projectSync } from '../services/projectSync';
import Dialog from './Dialog';

export const useAccountUser = () => useSyncExternalStore(subscribeAccount, currentUser);
export const useSyncStatus = () => useSyncExternalStore(projectSync.subscribe, projectSync.status);

const day = (time: number) => new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' });

interface FieldProps { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete: string; hint?: string }

function Field({ label, value, onChange, type = 'text', autoComplete, hint }: FieldProps) {
  const id = useId();
  return (
    <div className="account-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={value} autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(event) => onChange(event.target.value)} />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

// Runs one request for a form: disables it while waiting and shows what the server said.
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong. Try again.'); } finally { setBusy(false); }
  };
  return { busy, error, run };
}

function Form({ onSubmit, error, children }: { onSubmit: () => void; error: string; children: ReactNode }) {
  return (
    <form className="account-form" onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }}>
      {children}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [kept, setKept] = useState(false);
  return (
    <>
      <h3>Write down your recovery code</h3>
      <output className="account-code" aria-label="Your new recovery code">{code}</output>
      <p>
        This is the only way back in if you forget your password. Discobot has no email address for you, so nobody can reset it for you.
        The code is shown this once and works once; using it gives you a new one.
      </p>
      <label className="account-check">
        <input type="checkbox" checked={kept} onChange={(event) => setKept(event.target.checked)} />
        <span>I have written it down or saved it somewhere safe</span>
      </label>
      <div className="rack-dialog-actions start">
        <button className="rack-btn go" disabled={!kept} onClick={onDone}>Done</button>
      </div>
    </>
  );
}

type Mode = 'signin' | 'signup' | 'recover';

function SignedOut({ onRecoveryCode }: { onRecoveryCode: (code: string) => void }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const { busy, error, run } = useAction();

  const submit = () => run(async () => {
    if (mode === 'signin') await account.signIn(username, password);
    else if (mode === 'signup') onRecoveryCode(await account.signUp(username, password, invite));
    else onRecoveryCode(await account.recover(username, recoveryCode, password));
  });

  return (
    <>
      <div className="account-tabs" role="tablist" aria-label="Account">
        {([['signin', 'Sign In'], ['signup', 'Create Account'], ['recover', 'Forgot Password']] as const).map(([value, label]) => (
          <button key={value} role="tab" aria-selected={mode === value} className={`rack-btn ${mode === value ? 'on' : ''}`} onClick={() => setMode(value)}>{label}</button>
        ))}
      </div>
      <Form onSubmit={() => { void submit(); }} error={error}>
        <Field
          label="Username" value={username} onChange={setUsername} autoComplete="username"
          hint={mode === 'signup' ? '3 to 20 letters, numbers, - or _. Other people will see it on songs you publish, so do not use your real name unless you want it shown.' : undefined}
        />
        {mode === 'recover' && <Field label="Recovery code" value={recoveryCode} onChange={setRecoveryCode} autoComplete="off" hint="The code you were shown when you created the account." />}
        <Field
          label={mode === 'recover' ? 'New password' : 'Password'} value={password} onChange={setPassword} type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          hint={mode === 'signin' ? undefined : 'At least 10 characters. A few words in a row works well.'}
        />
        {mode === 'signup' && <Field label="Invite code" value={invite} onChange={setInvite} autoComplete="off" hint="Accounts are by invitation. Ask whoever told you about Discobot." />}
        <div className="rack-dialog-actions start">
          <button className="rack-btn go" type="submit" disabled={busy}>
            {busy ? 'One moment…' : mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Set New Password'}
          </button>
        </div>
      </Form>
      <p className="rack-empty">
        An account is optional, and Discobot works the same without one. An account stores your username, a scrambled form of your
        password and recovery code, the date you joined and the invite code you used. No email address, no name, nothing else.
        Signed in, your projects are also kept in your account, so they follow you to any browser you sign in on.
      </p>
    </>
  );
}

function OwnerTools() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState('');
  const { busy, error, run } = useAction();
  const load = async () => { const [nextInvites, nextMembers] = await Promise.all([account.invites(), account.members()]); setInvites(nextInvites); setMembers(nextMembers); };
  useEffect(() => { void run(load); }, []);

  return (
    <>
      <h3>Invite codes</h3>
      <p>Each code lets one person create an account.</p>
      <div className="rack-dialog-actions start">
        <button className="rack-btn" disabled={busy} onClick={() => { void run(async () => { await account.createInvite(); await load(); }); }}>New Invite Code</button>
      </div>
      {error && <p role="alert">{error}</p>}
      {invites?.length === 0 && <p className="rack-empty">No invite codes yet.</p>}
      {invites?.map(invite => (
        <div key={invite.code} className="rack-list-row" role="group" aria-label={`Invite ${invite.code}`}>
          <span>
            <strong className="account-mono">{invite.code}</strong>
            <small>{invite.usedAt ? `Used ${day(invite.usedAt)}${invite.usedBy ? ` by ${invite.usedBy}` : ' by an account since deleted'}` : `Not used yet · made ${day(invite.createdAt)}`}</small>
          </span>
          {!invite.usedAt && (
            <>
              <button className="rack-btn" onClick={() => { void navigator.clipboard.writeText(invite.code).then(() => setCopied(invite.code)).catch(() => {}); }}>{copied === invite.code ? 'Copied' : 'Copy'}</button>
              <button className="rack-btn danger" disabled={busy} onClick={() => { void run(async () => { await account.deleteInvite(invite.code); await load(); }); }}>Delete</button>
            </>
          )}
        </div>
      ))}
      <h3>Members</h3>
      {members.map(member => (
        <div key={member.username} className="rack-list-row" role="group" aria-label={`Member ${member.username}`}>
          <span>
            <strong>{member.username}</strong>
            <small>{member.owner ? 'Owner · ' : ''}Joined {day(member.createdAt)}</small>
          </span>
          {!member.owner && (
            <button
              className="rack-btn danger" disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove the account "${member.username}"? This cannot be undone.`)) void run(async () => { await account.removeMember(member.username); await load(); });
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </>
  );
}

function SignedIn({ username, owner, onRecoveryCode }: { username: string; owner: boolean; onRecoveryCode: (code: string) => void }) {
  const [panel, setPanel] = useState<'' | 'password' | 'code' | 'delete'>('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const { busy, error, run } = useAction();
  const sync = useSyncStatus();
  const open = (next: typeof panel) => { setPanel(panel === next ? '' : next); setPassword(''); setNewPassword(''); setNotice(''); };

  // The one request made without being asked: check the session is still good when the dialog opens.
  useEffect(() => { void account.refresh().catch(() => {}); }, []);

  return (
    <>
      <p>Signed in as <strong>{username}</strong>.</p>
      <div className="rack-list-row" role="group" aria-label="Project sync">
        <span>
          <strong>Project sync</strong>
          <small>
            {sync.state === 'syncing' ? 'Syncing…'
              : sync.state === 'error' ? `Not synced: ${sync.error}`
                : sync.lastSyncedAt ? `Up to date · ${sync.inAccount.length} in your account · checked ${new Date(sync.lastSyncedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}` : 'Waiting to sync'}
          </small>
        </span>
        <button className="rack-btn" disabled={sync.state === 'syncing'} onClick={() => { void projectSync.sync(); }}>Sync Now</button>
      </div>
      {sync.browserOnly.length > 0 && (
        <div className="rack-list-row" role="group" aria-label="Projects not in your account">
          <span>
            <strong>{sync.browserOnly.length === 1 ? '1 project is' : `${sync.browserOnly.length} projects are`} only in this browser</strong>
            <small>They were here before you signed in. Add them to keep them in your account too, or choose one at a time under Projects.</small>
          </span>
          <button className="rack-btn" disabled={sync.state === 'syncing'} onClick={() => { void projectSync.addToAccount(sync.browserOnly); }}>Add Them All</button>
        </div>
      )}
      <div className="account-actions">
        <button className="rack-btn go" disabled={busy} onClick={() => { void run(account.signOut); }}>Sign Out</button>
        <button className="rack-btn" disabled={busy} title="Sign out of every browser where this account is signed in" onClick={() => { void run(account.signOutEverywhere); }}>Sign Out Everywhere</button>
        <button className={`rack-btn ${panel === 'password' ? 'on' : ''}`} onClick={() => open('password')}>Change Password</button>
        <button className={`rack-btn ${panel === 'code' ? 'on' : ''}`} onClick={() => open('code')}>New Recovery Code</button>
        <button className={`rack-btn danger ${panel === 'delete' ? 'on' : ''}`} onClick={() => open('delete')}>Delete Account</button>
      </div>
      {notice && <p role="status">{notice}</p>}
      {panel === 'password' && (
        <Form error={error} onSubmit={() => { void run(async () => { await account.changePassword(password, newPassword); setPanel(''); setNotice('Password changed. Other browsers have been signed out.'); }); }}>
          <Field label="Current password" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          <Field label="New password" value={newPassword} onChange={setNewPassword} type="password" autoComplete="new-password" hint="At least 10 characters." />
          <div className="rack-dialog-actions start"><button className="rack-btn go" type="submit" disabled={busy}>Change Password</button></div>
        </Form>
      )}
      {panel === 'code' && (
        <Form error={error} onSubmit={() => { void run(async () => { onRecoveryCode(await account.newRecoveryCode(password)); }); }}>
          <p>Makes a new recovery code and cancels the old one.</p>
          <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          <div className="rack-dialog-actions start"><button className="rack-btn go" type="submit" disabled={busy}>Show New Code</button></div>
        </Form>
      )}
      {panel === 'delete' && (
        <Form error={error} onSubmit={() => { void run(async () => { await account.deleteAccount(password); }); }}>
          <p>Removes your account and the copies of your projects stored with it. Projects in this browser are not touched. This cannot be undone.</p>
          <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete="current-password" />
          <div className="rack-dialog-actions start"><button className="rack-btn danger" type="submit" disabled={busy}>Delete My Account</button></div>
        </Form>
      )}
      {panel === '' && error && <p role="alert">{error}</p>}
      {owner && <OwnerTools />}
    </>
  );
}

// Signing in, and everything about the signed-in account. Nothing here touches projects.
// While a recovery code is on screen the dialog only closes through its Done button: the
// code cannot be shown again.
export default function AccountDialog({ onClose }: { onClose: () => void }) {
  const user = useAccountUser();
  const [recoveryCode, setRecoveryCode] = useState('');
  return (
    <Dialog title="Account" closeLabel="Close account" onClose={recoveryCode ? () => {} : onClose}>
      {recoveryCode
        ? <RecoveryCode code={recoveryCode} onDone={() => setRecoveryCode('')} />
        : user
          ? <SignedIn username={user.username} owner={user.owner} onRecoveryCode={setRecoveryCode} />
          : <SignedOut onRecoveryCode={setRecoveryCode} />}
    </Dialog>
  );
}
