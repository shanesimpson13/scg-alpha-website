/* The withdrawal page's logic, bundled rather than loaded from a CDN.
 *
 * These wallets are held on Privy's servers. Nothing on the device holds a
 * key, so the terminal cannot sign; and the server cannot either, because our
 * key is an extra signer that policy confines to swaps and Privy will not mint
 * a user signing key from an access token for an app on native auth. Their
 * client SDK is the only thing that can, so this page uses it directly.
 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrivyProvider, usePrivy, useLoginWithEmail, getAccessToken } from '@privy-io/react-auth';
import { useWallets, useSignTransaction } from '@privy-io/react-auth/solana';

const API = 'https://api.edgelvl.app';
const APP_ID = 'cmsasu2fa00930dlc04skfjwl';   // public identifier, not a secret

const b64 = (bytes) => {
  // Chunked: spreading a byte array into fromCharCode blows the stack on
  // anything large, and quietly works until it does not.
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};

function Panel() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { sendCode, loginWithCode } = useLoginWithEmail();
  const { wallets } = useWallets();
  const { signTransaction } = useSignTransaction();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [kind, setKind] = useState('');
  const say = (t, k = '') => { setMsg(t); setKind(k); };

  if (!ready) return <div>Loading…</div>;

  if (!authenticated) {
    return (
      <div>
        <h1>Withdraw</h1>
        <p className="lede">Sign in with the same email you use on the terminal.</p>
        <label>Email</label>
        <input value={email} autoComplete="email" placeholder="you@example.com"
               onChange={(e) => setEmail(e.target.value)} />
        {sent && (<>
          <label>Code</label>
          <input value={code} inputMode="numeric" placeholder="123456"
                 onChange={(e) => setCode(e.target.value)} />
        </>)}
        <button disabled={busy || !email} onClick={async () => {
          setBusy(true);
          try {
            if (!sent) { await sendCode({ email }); setSent(true); say('Code sent.'); }
            else { await loginWithCode({ code }); say(null); }
          } catch (e) { say(e.message || String(e), 'bad'); }
          setBusy(false);
        }}>{busy ? 'Working…' : (sent ? 'Sign in' : 'Send code')}</button>
        {msg && <div className={'msg ' + kind}>{msg}</div>}
        <a className="back" href="/">← back to the terminal</a>
      </div>
    );
  }

  const wallet = wallets[0];
  return (
    <div>
      <h1>Withdraw</h1>
      <p className="lede">Everything except the network fee and the account rent.</p>
      <div className="row"><span>Account</span>
        <span>{user?.email?.address || user?.id || '—'}</span></div>
      <div className="row"><span>Wallet</span>
        <span>{wallet ? wallet.address : 'none found'}</span></div>
      <label>Destination</label>
      <input value={dest} placeholder="Solana address" spellCheck={false}
             onChange={(e) => setDest(e.target.value)} />
      <button disabled={busy || !dest || !wallet} onClick={async () => {
        setBusy(true);
        try {
          say('Preparing…');
          const token = await getAccessToken();
          const auth = { Authorization: 'Bearer ' + token,
                         'Content-Type': 'application/json' };
          // The server works out what is actually withdrawable and builds the
          // transfer. It simply cannot sign it.
          const r = await fetch(API + '/api/withdraw/build', {
            method: 'POST', headers: auth,
            body: JSON.stringify({ destination: dest.trim() }),
          });
          const built = await r.json();
          if (!r.ok) throw new Error(built.detail || 'could not prepare it');

          say(`Signing ${Number(built.amount_sol).toFixed(4)} SOL…`);
          // Raw bytes in, raw bytes out. The hook takes a Uint8Array, not a
          // web3.js Transaction, and hands one back — passing the object and
          // calling .serialize() on the result is what broke the first try.
          const bytes = Uint8Array.from(atob(built.transaction), (c) => c.charCodeAt(0));
          const { signedTransaction } = await signTransaction({ transaction: bytes, wallet });

          say('Sending…');
          const s2 = await fetch(API + '/api/withdraw/submit', {
            method: 'POST', headers: auth,
            body: JSON.stringify({ transaction: b64(signedTransaction) }),
          });
          const out = await s2.json();
          if (!s2.ok) throw new Error(out.detail || 'the network refused it');
          say(`Sent ${Number(built.amount_sol).toFixed(4)} SOL — ${out.explorer}`, 'good');
        } catch (e) {
          // Some of these arrive as plain objects rather than Errors, and
          // String(e) on one of those is a useless "[object Object]".
          const detail = e?.message || e?.error || e?.code ||
                         (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
          say(String(detail).slice(0, 300), 'bad');
          console.error('withdraw failed:', e);
        }
        setBusy(false);
      }}>{busy ? 'Working…' : 'Withdraw everything'}</button>
      {msg && <div className={'msg ' + kind}>{msg}</div>}
      <a className="back" href="#" onClick={(e) => { e.preventDefault(); logout(); }}>sign out</a>
      {' · '}
      <a className="back" href="/">back to the terminal</a>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <PrivyProvider appId={APP_ID}
    config={{
      loginMethods: ['email'],
      /* showWalletUIs off: Privy otherwise opens a confirmation modal over the
         page to sign, and here it renders as an empty black overlay with no
         error — the signature never happens and nothing says why. The account
         holder has already signed in and pressed Withdraw on this page, which
         is the confirmation. */
      embeddedWallets: { createOnLogin: 'off', showWalletUIs: false },
    }}>
    <Panel />
  </PrivyProvider>
);
