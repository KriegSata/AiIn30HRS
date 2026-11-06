'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface DiscoveryPosition { latitude: number; longitude: number }
export type DiscoveryStatus = 'idle' | 'locating' | 'enabled' | 'dismissed' | 'error';

/** A single opt-in reading, scoped to this mounted authenticated workspace.
 * Never write these coordinates to storage, a profile, or analytics. */
export function useMarketplaceLocation(onRankingChange: () => void) {
  const [position, setPosition] = useState<DiscoveryPosition | null>(null);
  const [status, setStatus] = useState<DiscoveryStatus>('idle');
  const [message, setMessage] = useState('');
  const positionRef = useRef<DiscoveryPosition | null>(null);
  const attempt = useRef(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelAttempt = useCallback(() => {
    attempt.current++;
    pending.current = false;
    if (deadline.current) clearTimeout(deadline.current);
    deadline.current = undefined;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelAttempt(); positionRef.current = null; };
  }, [cancelAttempt]);

  const changePosition = useCallback((next: DiscoveryPosition | null) => {
    if (positionRef.current?.latitude === next?.latitude && positionRef.current?.longitude === next?.longitude) return;
    onRankingChange();
    positionRef.current = next;
    setPosition(next);
  }, [onRankingChange]);

  const dismiss = useCallback(() => {
    cancelAttempt();
    changePosition(null);
    setMessage('Location is off. Browse most popular products.');
    setStatus('dismissed');
  }, [cancelAttempt, changePosition]);

  const enable = useCallback(() => {
    if (pending.current || !mounted.current) return;
    cancelAttempt();
    const request = attempt.current;
    pending.current = true;
    setMessage('');
    setStatus('locating');
    const current = () => mounted.current && attempt.current === request;
    const fail = (explanation: string) => {
      if (!current()) return;
      cancelAttempt();
      changePosition(null);
      setMessage(explanation);
      setStatus('error');
    };
    if (!navigator.geolocation) {
      fail('This browser does not support location. You can still browse most popular products.');
      return;
    }
    // The browser timeout can exclude time spent waiting for permission. This
    // deadline also ends that wait, without retrying or accepting a late result.
    deadline.current = setTimeout(() => fail('Location took too long. Showing most popular products. You can try again when your connection is ready.'), 12000);
    try {
      navigator.geolocation.getCurrentPosition(result => {
        if (!current()) return;
        const { latitude, longitude } = result.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          fail('Your location could not be read. Showing most popular products. You can try again.');
          return;
        }
        cancelAttempt();
        changePosition({ latitude: Math.round(latitude * 100) / 100, longitude: Math.round(longitude * 100) / 100 });
        setMessage('Recommended order uses approximate supplier locations, not travel distance or delivery coverage.');
        setStatus('enabled');
      }, error => {
        fail(error.code === 1
          ? 'Location access was denied. Allow location in your browser’s site settings, then try again. Showing most popular products.'
          : error.code === 3
            ? 'Location took too long. Showing most popular products. You can try again.'
            : 'Your location is unavailable. Showing most popular products. Check your device location settings or try again.');
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 });
    } catch {
      fail('Location is unavailable in this browser. Showing most popular products. You can try again.');
    }
  }, [cancelAttempt, changePosition]);

  return { position, status, message, enable, dismiss, usePopular: dismiss };
}
