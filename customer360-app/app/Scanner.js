'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Scanner() {
  const router = useRouter();
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const scannerRef = useRef(null);
  const startedRef = useRef(false);

  function go(code) {
    const trimmed = (code || '').trim();
    if (!trimmed) return;
    router.push(`/customer/${encodeURIComponent(trimmed)}`);
  }

  useEffect(() => {
    let html5;
    let cancelled = false;

    async function start() {
      if (startedRef.current) return;
      startedRef.current = true;
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        html5 = new Html5Qrcode('reader', { verbose: false });
        scannerRef.current = html5;
        await html5.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (cancelled) return;
            html5.stop().catch(() => {});
            go(decodedText);
          },
          () => {}
        );
      } catch (e) {
        setError(
          'Camera unavailable. Grant camera permission (HTTPS required), or enter the record id manually below.'
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      const inst = scannerRef.current;
      scannerRef.current = null;
      if (!inst) return;
      // html5-qrcode's stop()/clear() throw synchronously if the camera isn't
      // running (e.g. during a client-side route change). Guard on state and
      // swallow teardown errors so navigation never surfaces a client exception.
      try {
        // Html5QrcodeScannerState: SCANNING === 2, PAUSED === 3
        const state = inst.getState?.();
        if (state === 2 || state === 3) {
          inst
            .stop()
            .then(() => {
              try { inst.clear?.(); } catch (_) {}
            })
            .catch(() => {});
        } else {
          try { inst.clear?.(); } catch (_) {}
        }
      } catch (_) {
        /* ignore teardown errors */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div id="reader" />
      {error ? <div className="warn">{error}</div> : <div className="scan-hint">Camera active — hold steady over the code.</div>}

      <div className="manual">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Customer Reference Id"
          onKeyDown={(e) => e.key === 'Enter' && go(manual)}
        />
        <button className="btn" onClick={() => go(manual)}>Open</button>
      </div>
    </div>
  );
}
