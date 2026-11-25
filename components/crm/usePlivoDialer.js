// Browser-side dialer built on Plivo's official Browser SDK (v2.2.21, served
// from /public/vendor so no third-party script host is involved).
//
// Privacy: the browser never receives the customer's number. It asks our API
// to initiate a call for a lead id, gets back an opaque single-use token and
// dials that token. Plivo then asks our server (Answer URL) for the real
// destination.
import { useCallback, useEffect, useRef, useState } from 'react';
import { crmFetch } from '../../utils/crmClient';

const SDK_URL = '/vendor/plivo/plivo-browser-sdk-2.2.21.min.js';
let sdkPromise = null;
let shared = null; // one SDK client per page

function loadSdk() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Not in a browser'));
  if (window.Plivo) return Promise.resolve(window.Plivo);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.async = true;
      s.onload = () => (window.Plivo ? resolve(window.Plivo) : reject(new Error('Dialer failed to load')));
      s.onerror = () => { sdkPromise = null; reject(new Error('Dialer failed to load. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

const FAILURE_MESSAGES = {
  'Busy Here': 'Customer is busy',
  Busy: 'Customer is busy',
  'Request Terminated': 'Call was cancelled',
  'Not Found': 'Number could not be reached',
  Unavailable: 'Customer is unavailable',
  'No Answer': 'No answer',
  Rejected: 'Call was rejected',
  Forbidden: 'Call was not allowed',
};

// status: idle | preparing | connecting | ringing | connected | ending | ended | failed
export default function usePlivoDialer() {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [callId, setCallId] = useState(null);
  const [leadName, setLeadName] = useState('');
  const callIdRef = useRef(null);
  const statusRef = useRef('idle');
  const timerRef = useRef(null);
  const closedRef = useRef(false);

  const set = (s) => { statusRef.current = s; setStatus(s); };

  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };

  // Tells the server the call is over (idempotent). Ensures the provider leg
  // is closed and the call log is finalised even if a webhook is late.
  const closeOnServer = useCallback(async (reason, keepalive = false) => {
    const id = callIdRef.current;
    if (!id || closedRef.current) return;
    closedRef.current = true;
    try {
      await crmFetch(`/api/crm/calls/${encodeURIComponent(id)}/hangup`, { method: 'POST', body: reason ? { reason } : {}, keepalive });
    } catch {
      // The Plivo webhooks will still close the call.
    }
  }, []);

  const onEnded = useCallback((failure) => {
    stopTimer();
    setMuted(false);
    if (failure) {
      setError(failure);
      set('failed');
    } else {
      set('ended');
    }
    closeOnServer(failure);
  }, [closeOnServer]);

  const handlersRef = useRef({});
  handlersRef.current = {
    onCalling: () => statusRef.current === 'preparing' && set('connecting'),
    onCallRemoteRinging: () => set('ringing'),
    onCallAnswered: () => {
      set('connected');
      setSeconds(0);
      stopTimer();
      const started = Date.now();
      timerRef.current = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    },
    onCallTerminated: () => onEnded(null),
    onCallFailed: (cause) => onEnded(FAILURE_MESSAGES[cause] || (cause ? `Call failed: ${cause}` : 'Call failed')),
    onMediaPermission: (evt) => {
      if (evt && evt.status === 'failure') onEnded('Microphone access was blocked. Allow microphone access for this site and try again.');
    },
    onPermissionDenied: () => onEnded('Microphone access was blocked. Allow microphone access for this site and try again.'),
    onConnectionChange: (evt) => {
      if (evt && evt.state === 'disconnected' && ['connecting', 'ringing', 'connected'].includes(statusRef.current)) {
        setError('Network connection lost. Reconnecting…');
      }
    },
  };

  const getClient = useCallback(async () => {
    if (shared?.ready) return shared.client;
    const Plivo = await loadSdk();
    if (!shared) {
      const sdk = new Plivo({ debug: 'ERROR', permOnClick: true, closeProtection: true, allowMultipleIncomingCalls: false });
      const client = sdk.client;
      shared = { sdk, client, ready: false, loginPromise: null };
      Object.keys(handlersRef.current).forEach((evt) => {
        client.on(evt, (...args) => shared.handlers?.[evt]?.(...args));
      });
      client.on('onWebrtcNotSupported', () => shared.handlers?.onCallFailed?.('This browser does not support calling. Use the latest Chrome, Edge or Firefox.'));
    }
    shared.handlers = handlersRef.current;
    if (!shared.loginPromise) {
      shared.loginPromise = new Promise((resolve, reject) => {
        const { client } = shared;
        const ok = () => { client.off?.('onLogin', ok); client.off?.('onLoginFailed', bad); shared.ready = true; resolve(client); };
        const bad = (reason) => { client.off?.('onLogin', ok); client.off?.('onLoginFailed', bad); shared.loginPromise = null; reject(new Error(shared.tokenError || `Could not connect the dialer${reason ? ` (${reason})` : ''}`)); };
        client.on('onLogin', ok);
        client.on('onLoginFailed', bad);
        // The SDK calls getAccessToken again whenever the token needs renewing.
        client.loginWithAccessTokenGenerator({
          getAccessToken: async () => {
            try {
              const res = await crmFetch('/api/crm/calls/token', { method: 'POST', body: {} });
              shared.tokenError = null;
              return res.token;
            } catch (err) {
              shared.tokenError = err.message;
              throw err;
            }
          },
        });
      });
    }
    return shared.loginPromise;
  }, []);

  useEffect(() => {
    if (shared) shared.handlers = handlersRef.current;
  });

  // Close the call if the tab is closed mid-call.
  useEffect(() => {
    const onUnload = () => {
      if (['connecting', 'ringing', 'connected'].includes(statusRef.current)) {
        try { shared?.client?.hangup(); } catch { /* ignore */ }
        closeOnServer('Browser tab closed', true);
      }
    };
    window.addEventListener('pagehide', onUnload);
    return () => {
      window.removeEventListener('pagehide', onUnload);
      // Leaving the screen mid-call ends the call rather than orphaning it.
      onUnload();
      stopTimer();
    };
  }, [closeOnServer]);

  const call = useCallback(async (leadId) => {
    if (['preparing', 'connecting', 'ringing', 'connected', 'ending'].includes(statusRef.current)) return;
    setError('');
    setMuted(false);
    setSeconds(0);
    closedRef.current = false;
    callIdRef.current = null;
    setCallId(null);
    set('preparing');
    try {
      const client = await getClient();
      const res = await crmFetch('/api/crm/calls/initiate', { method: 'POST', body: { leadId } });
      callIdRef.current = res.callId;
      setCallId(res.callId);
      setLeadName(res.leadName);
      const started = client.call(res.destination, res.headers);
      if (started === false) onEnded('The dialer could not start the call. Check your microphone and try again.');
    } catch (err) {
      stopTimer();
      setError(err.message || 'Could not start the call');
      set('failed');
      if (callIdRef.current) closeOnServer(err.message);
    }
  }, [getClient, onEnded, closeOnServer]);

  const hangup = useCallback(() => {
    if (!['preparing', 'connecting', 'ringing', 'connected'].includes(statusRef.current)) return;
    set('ending');
    try { shared?.client?.hangup(); } catch { /* ignore */ }
    // If the SDK never emits a terminate event (e.g. call not yet placed),
    // finish locally after a short grace period.
    setTimeout(() => { if (statusRef.current === 'ending') onEnded(null); }, 4000);
  }, [onEnded]);

  const toggleMute = useCallback(() => {
    if (statusRef.current !== 'connected' || !shared?.client) return;
    if (muted) { shared.client.unmute(); setMuted(false); } else { shared.client.mute(); setMuted(true); }
  }, [muted]);

  const reset = useCallback(() => {
    setError('');
    setSeconds(0);
    callIdRef.current = null;
    setCallId(null);
    set('idle');
  }, []);

  return { status, error, muted, seconds, callId, leadName, call, hangup, toggleMute, reset, busy: ['preparing', 'connecting', 'ringing', 'connected', 'ending'].includes(status) };
}
