// Browser-to-browser connection for versus matches.
// Real matches use WebRTC through PeerJS: its public broker (0.peerjs.com) only introduces the two
// browsers; game messages then flow directly between them (encrypted), relayed by PeerJS's TURN
// server when a router blocks a direct path. Codes starting with "LOCAL" use a BroadcastChannel
// instead (two tabs of the same browser), for testing alone.

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L
const ID_PREFIX = 'protogame-ember-';
export const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

let peerLib = null;
function loadPeer() {
  if (window.peerjs) return Promise.resolve(window.peerjs);
  if (!peerLib) peerLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/peerjs/peerjs.min.js';
    s.onload = () => (window.peerjs ? resolve(window.peerjs) : reject(new Error('PeerJS failed to load')));
    s.onerror = () => reject(new Error('PeerJS failed to load'));
    document.head.appendChild(s);
  });
  return peerLib;
}

/** One open connection. Messages are plain JSON objects; the channel is reliable and ordered. */
export class Link {
  constructor(role, code) {
    this.role = role;          // 'host' | 'guest'
    this.code = code;
    this.open = false;
    this.handlers = new Set();
    this.closers = new Set();
    this._send = () => {};
    this._close = () => {};
    this._onHide = () => this.close();   // closing the tab tells the friend right away
    window.addEventListener('pagehide', this._onHide);
  }
  send(msg) { if (this.open) this._send(msg); }
  onMessage(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  onClose(fn) { this.closers.add(fn); return () => this.closers.delete(fn); }
  _deliver(msg) { if (msg && typeof msg === 'object') for (const fn of [...this.handlers]) fn(msg); }
  _closed() {
    if (this._wasClosed) return;
    this._wasClosed = true; this.open = false;
    window.removeEventListener('pagehide', this._onHide);
    for (const fn of [...this.closers]) fn();
  }
  close() { if (!this._wasClosed) this._close(); this._closed(); }
}

/**
 * Host a match. `onCode(code)` fires as soon as the code is reserved; the promise resolves with
 * the Link when a friend joins. `cancel()` on the returned controller stops waiting.
 */
export function host({ local = false, onCode, onStatus = () => {} }) {
  let cancelled = false, cleanup = () => {};
  const ctl = { cancel: () => { cancelled = true; cleanup(); } };
  ctl.ready = new Promise((resolve, reject) => {
    if (local) {
      const code = 'LOCAL' + newCode();
      const ch = new BroadcastChannel('pg-' + code);
      cleanup = () => ch.close();
      onCode(code);
      ch.onmessage = (ev) => {
        if (ev.data?.type !== '_join' || cancelled) return;
        const link = new Link('host', code);
        link._send = (m) => ch.postMessage({ from: 'host', m });
        link._close = () => { try { ch.postMessage({ from: 'host', m: { type: '_bye' } }); } catch { /* closed */ } ch.close(); };
        ch.onmessage = (e2) => { if (e2.data?.from !== 'guest') return; if (e2.data.m?.type === '_bye') link._closed(); else link._deliver(e2.data.m); };
        link.open = true;
        ch.postMessage({ from: 'host', m: { type: '_welcome' } });
        resolve(link);
      };
      return;
    }
    loadPeer().then(({ Peer }) => {
      const attempt = (tries) => {
        const code = newCode();
        const peer = new Peer(ID_PREFIX + code);
        cleanup = () => peer.destroy();
        peer.on('open', () => { if (!cancelled) onCode(code); });
        peer.on('error', (err) => {
          if (err.type === 'unavailable-id' && tries < 4) { peer.destroy(); attempt(tries + 1); return; }
          if (!cancelled) reject(new Error(netError(err)));
        });
        peer.on('disconnected', () => onStatus('Lost the matchmaking server, reconnecting…'));
        peer.on('connection', (conn) => {
          if (cancelled) { conn.close(); return; }
          conn.on('open', () => {
            const link = wrapConn(conn, 'host', code, peer);
            resolve(link);
          });
        });
      };
      attempt(0);
    }, reject);
  });
  return ctl;
}

/** Join a friend's match by code. */
export function join(codeIn, { onStatus = () => {} } = {}) {
  const code = cleanCode(codeIn);
  return new Promise((resolve, reject) => {
    if (!code) { reject(new Error('Type the code your friend sees.')); return; }
    if (code.startsWith('LOCAL')) {
      const ch = new BroadcastChannel('pg-' + code);
      const timer = setTimeout(() => { ch.close(); reject(new Error('No match with that code in this browser.')); }, 3000);
      const link = new Link('guest', code);
      link._send = (m) => ch.postMessage({ from: 'guest', m });
      link._close = () => { try { ch.postMessage({ from: 'guest', m: { type: '_bye' } }); } catch { /* closed */ } ch.close(); };
      ch.onmessage = (ev) => {
        if (ev.data?.from !== 'host') return;
        const m = ev.data.m;
        if (m?.type === '_welcome') { clearTimeout(timer); link.open = true; resolve(link); return; }
        if (m?.type === '_bye') link._closed(); else link._deliver(m);
      };
      ch.postMessage({ type: '_join' });
      return;
    }
    loadPeer().then(({ Peer }) => {
      const peer = new Peer();
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('Could not reach your friend. Check the code, and that their page is still open.')); }, 20000);
      peer.on('error', (err) => { clearTimeout(timer); peer.destroy(); reject(new Error(netError(err))); });
      peer.on('open', () => {
        onStatus('Connecting to your friend…');
        const conn = peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('open', () => { clearTimeout(timer); resolve(wrapConn(conn, 'guest', code, peer)); });
      });
    }, reject);
  });
}

function wrapConn(conn, role, code, peer) {
  const link = new Link(role, code);
  link._send = (m) => conn.send(m);
  link._close = () => { conn.close(); peer.destroy(); };
  conn.on('data', (d) => link._deliver(typeof d === 'string' ? safeParse(d) : d));
  conn.on('close', () => link._closed());
  conn.on('error', () => link._closed());
  link.open = true;
  return link;
}
const safeParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

function netError(err) {
  switch (err?.type) {
    case 'peer-unavailable': return 'No match with that code. Check it, and that your friend is still hosting.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'Could not reach the matchmaking server. Check your internet connection.';
    case 'browser-incompatible': return 'This browser does not support peer-to-peer connections.';
    default: return err?.message || 'Connection failed.';
  }
}
