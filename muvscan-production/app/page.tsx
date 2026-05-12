'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApiDetection,
  Detection,
  InventoryItem,
  ScanApiResponse,
  ScanStatus,
} from '@/lib/types';
import { ROOMS, getEmoji, getVolume, suggestTruck, TRUCK_SIZES } from '@/lib/volumes';

const SCAN_INTERVAL_MS = 5000;
const MAX_BOXES = 6;
const INVENTORY_STORAGE_KEY = 'muvscan.inventory.v1';
const ROOM_STORAGE_KEY = 'muvscan.room.v1';
const TRUCK_CAP = TRUCK_SIZES[TRUCK_SIZES.length - 2].capacity; // 26-ft truck

export default function ScannerPage() {
  // ── State ─────────────────────────────────────────
  const [status, setStatus] = useState<ScanStatus>('idle');
  const [statusText, setStatusText] = useState('Ready');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [room, setRoom] = useState<string>(ROOMS[0]);
  const [customRooms, setCustomRooms] = useState<string[]>([]);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // ── Refs ──────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scanInFlightRef = useRef(false);

  // ── Persistence ───────────────────────────────────
  useEffect(() => {
    try {
      const savedInv = localStorage.getItem(INVENTORY_STORAGE_KEY);
      const savedRoom = localStorage.getItem(ROOM_STORAGE_KEY);
      if (savedInv) setInventory(JSON.parse(savedInv));
      if (savedRoom && (ROOMS as readonly string[]).includes(savedRoom)) setRoom(savedRoom);
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(inventory));
    } catch {
      /* ignore */
    }
  }, [inventory, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(ROOM_STORAGE_KEY, room);
    } catch {
      /* ignore */
    }
  }, [room, hydrated]);

  // ── Cleanup ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Camera ────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError(null);
    setStatus('idle');
    setStatusText('Starting camera…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      setStatus('scanning');
      setStatusText('Scanning');
    } catch (err) {
      const e = err as DOMException;
      console.error('Camera error:', e.name, e.message);
      const msg =
        e.name === 'NotAllowedError'
          ? 'Camera access denied. Please allow camera access and reload.'
          : e.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : 'Unable to start camera. ' + (e.message || 'Unknown error.');
      setCameraError(msg);
      setStatusText('Camera unavailable');
    }
  }, []);

  // Auto-start if permission already granted
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.permissions) return;
    navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then((perm) => {
        if (perm.state === 'granted') startCamera();
      })
      .catch(() => {
        /* permissions API not supported — user will tap enable */
      });
  }, [startCamera]);

  // ── Scan loop ─────────────────────────────────────
  const runScan = useCallback(async () => {
    if (scanInFlightRef.current || !cameraReady) return;
    if (!videoRef.current || !canvasRef.current || !wrapRef.current) return;
    const video = videoRef.current;
    if (!video.videoWidth || !video.videoHeight) return;

    scanInFlightRef.current = true;
    setStatus('analyzing');
    setStatusText('Analyzing…');

    // Cancel any prior in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    try {
      // ── Capture frame (object-fit: cover crop) ──
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      const vW = video.videoWidth;
      const vH = video.videoHeight;
      const cW = wrap.clientWidth;
      const cH = wrap.clientHeight;
      const vAR = vW / vH;
      const cAR = cW / cH;
      let sx: number, sy: number, sw: number, sh: number;
      if (vAR > cAR) {
        sh = vH;
        sw = vH * cAR;
        sy = 0;
        sx = (vW - sw) / 2;
      } else {
        sw = vW;
        sh = vW / cAR;
        sx = 0;
        sy = (vH - sh) / 2;
      }

      // Target ~1024px wide for upload (keeps tokens / payload reasonable)
      canvas.width = Math.round(Math.min(cW, 1024));
      canvas.height = Math.round(canvas.width * (cH / cW));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const base64 = canvas.toDataURL('image/jpeg', 0.78).split(',')[1];

      // ── Send to API ──
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = errBody.error || `Scan failed (HTTP ${res.status}).`;
        if (res.status === 429) {
          setErrorToast('Scanning too fast. Pausing for a moment.');
          setTimeout(() => setErrorToast(null), 4000);
        } else if (res.status >= 500) {
          setErrorToast(msg);
          setTimeout(() => setErrorToast(null), 4000);
        }
        setStatus('error');
        setStatusText('Retrying…');
        return;
      }

      const data: ScanApiResponse = await res.json();

      if (data.items && data.items.length > 0) {
        // Filter out items already in inventory for the current room
        const inventoryKeys = new Set(
          inventory.filter((i) => i.room === room).map((i) => i.name.toLowerCase())
        );
        const fresh = data.items
          .filter((i: ApiDetection) => !inventoryKeys.has(i.name.toLowerCase()))
          .slice(0, MAX_BOXES);

        if (fresh.length > 0) {
          setDetections(
            fresh.map((item) => ({
              ...item,
              id: 'b_' + Math.random().toString(36).slice(2, 10),
              dismissed: false,
              added: false,
            }))
          );
        }
      }
      setStatus('scanning');
      setStatusText('Scanning');
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') return; // intentional cancel
      console.error('Scan error:', e);
      setStatus('error');
      setStatusText('Scan error');
      setErrorToast('Scan failed. We\u2019ll try again automatically.');
      setTimeout(() => {
        setErrorToast(null);
        setStatus('scanning');
        setStatusText('Scanning');
      }, 4000);
    } finally {
      scanInFlightRef.current = false;
    }
  }, [cameraReady, inventory, room]);

  // Drive the scan loop
  useEffect(() => {
    if (!cameraReady) return;
    // First scan shortly after camera ready
    const first = setTimeout(() => runScan(), 1000);

    scanTimerRef.current = setInterval(() => {
      // Only run a fresh scan when no detections are awaiting user input
      const pending = detections.filter((d) => !d.dismissed && !d.added);
      if (pending.length === 0 && !scanInFlightRef.current) {
        runScan();
      }
    }, SCAN_INTERVAL_MS);

    return () => {
      clearTimeout(first);
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [cameraReady, runScan, detections]);

  // ── Detection interactions ────────────────────────
  const handleBoxTap = (id: string) => {
    setSelectedBoxId(id);
  };

  const selectedDet = selectedBoxId ? detections.find((d) => d.id === selectedBoxId) : null;

  const handleAdd = () => {
    if (!selectedDet) return;
    const vol = getVolume(selectedDet.name, selectedDet.volume_cuft);

    // Merge with existing if same name + same room
    const existingIdx = inventory.findIndex(
      (i) => i.name.toLowerCase() === selectedDet.name.toLowerCase() && i.room === room
    );

    if (existingIdx >= 0) {
      const next = [...inventory];
      next[existingIdx] = { ...next[existingIdx], qty: next[existingIdx].qty + 1 };
      setInventory(next);
    } else {
      const newItem: InventoryItem = {
        id: 'i_' + Math.random().toString(36).slice(2, 10),
        name: selectedDet.name,
        category: selectedDet.category,
        emoji: getEmoji(selectedDet.name, selectedDet.category),
        vol,
        wt: selectedDet.weight_lb || 0,
        qty: 1,
        room,
        fragile: !!selectedDet.fragile,
        heavy: !!selectedDet.heavy,
        disassemblyNeeded: !!selectedDet.disassembly_needed,
        addedAt: new Date().toISOString(),
      };
      setInventory((inv) => [...inv, newItem]);
    }

    // Haptic feedback if supported
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15);

    // Mark detection added, clear selection
    setDetections((ds) => ds.map((d) => (d.id === selectedDet.id ? { ...d, added: true, dismissed: true } : d)));
    setSelectedBoxId(null);

    // Open panel after first item
    if (inventory.length === 0) setPanelOpen(true);

    // Flash feedback
    flashAdd();
  };

  const handleSkip = () => {
    if (!selectedDet) return;
    setDetections((ds) =>
      ds.map((d) => (d.id === selectedDet.id ? { ...d, dismissed: true } : d))
    );
    setSelectedBoxId(null);
  };

  const flashAdd = () => {
    const el = document.getElementById('add-flash');
    if (el) {
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 380);
    }
  };

  // ── Inventory actions ─────────────────────────────
  const changeQty = (id: string, delta: number) => {
    setInventory((inv) =>
      inv
        .map((i) => (i.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i))
    );
  };

  const removeItem = (id: string) => {
    setInventory((inv) => inv.filter((i) => i.id !== id));
  };

  const exportInventory = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      app: 'MüvScan',
      version: '1.0.0',
      totals: {
        items: inventory.reduce((s, i) => s + i.qty, 0),
        volume_cuft: inventory.reduce((s, i) => s + i.vol * i.qty, 0),
        weight_lb: inventory.reduce((s, i) => s + i.wt * i.qty, 0),
      },
      inventory,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `muvscan-inventory-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const clearInventory = () => {
    if (typeof window !== 'undefined' && window.confirm('Clear all scanned items? This cannot be undone.')) {
      setInventory([]);
    }
  };

  // ── Room handling ─────────────────────────────────
  const allRooms = [...ROOMS, ...customRooms];

  const addCustomRoom = () => {
    if (typeof window === 'undefined') return;
    const name = window.prompt('Custom room name?')?.trim();
    if (!name) return;
    if (allRooms.includes(name)) {
      setRoom(name);
      return;
    }
    setCustomRooms((r) => [...r, name]);
    setRoom(name);
  };

  // ── Derived totals ────────────────────────────────
  const totalVol = inventory.reduce((s, i) => s + i.vol * i.qty, 0);
  const totalCount = inventory.reduce((s, i) => s + i.qty, 0);
  const totalWt = inventory.reduce((s, i) => s + i.wt * i.qty, 0);
  const truckPct = Math.min(100, Math.round((totalVol / TRUCK_CAP) * 100));
  const suggestedTruck = suggestTruck(totalVol);

  // ── Bounding box positioning ──────────────────────
  const visibleDetections = detections.filter((d) => !d.dismissed && !d.added);
  const wrapW = wrapRef.current?.clientWidth ?? 0;
  const wrapH = wrapRef.current?.clientHeight ?? 0;

  // ── Add prompt positioning (above panel + footer) ─
  const PANEL_COLLAPSED = 74;
  const PANEL_EXPANDED = Math.min(typeof window !== 'undefined' ? window.innerHeight * 0.72 : 500, 480);
  const promptBottom = (panelOpen ? PANEL_EXPANDED : PANEL_COLLAPSED) + 10;

  return (
    <div className="app">
      {/* ── Header ─────────────────────────────── */}
      <div className="header">
        <div className="header-top">
          <div className="logo">
            <span className="logo-muv">MÜV</span>
            <span className="logo-scan">Scan</span>
          </div>
          <div className="status">
            <span className={`status-dot ${status}`} />
            <span>{statusText}</span>
          </div>
        </div>
        <div className="rooms-scroll">
          {allRooms.map((r) => (
            <button
              key={r}
              className={`room-chip ${r === room ? 'active' : ''}`}
              onClick={() => setRoom(r)}
              aria-pressed={r === room}
            >
              {r}
            </button>
          ))}
          <button className="room-chip" onClick={addCustomRoom} aria-label="Add custom room">
            + Custom
          </button>
        </div>
      </div>

      {/* ── Error toast ────────────────────────── */}
      <div className={`error-toast ${errorToast ? 'visible' : ''}`} role="alert">
        <span>{errorToast}</span>
        <button onClick={() => setErrorToast(null)}>Dismiss</button>
      </div>

      {/* ── Camera area ────────────────────────── */}
      <div className="camera-wrap" ref={wrapRef}>
        {!cameraReady && (
          <div className="placeholder">
            <div className="placeholder-icon">📷</div>
            <h2>Enable Camera</h2>
            <p>{cameraError ?? 'MüvScan uses AI vision to identify and catalog every item in your home.'}</p>
            <button className="enable-btn" onClick={startCamera}>
              {cameraError ? 'Retry' : 'Enable Camera'}
            </button>
          </div>
        )}
        <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
        <canvas ref={canvasRef} className="camera-canvas" />
        <div className={`scan-frame ${cameraReady ? 'active' : ''}`}>
          <div className="corner" />
        </div>
        {cameraReady && <div className="scan-line" />}

        {/* Bounding boxes */}
        <div className="bbox-layer">
          {visibleDetections.map((det) => {
            const x = det.bbox.x * wrapW;
            const y = det.bbox.y * wrapH;
            const w = det.bbox.w * wrapW;
            const h = det.bbox.h * wrapH;
            const isSelected = det.id === selectedBoxId;
            const labelFlipped = y < 40;
            return (
              <div
                key={det.id}
                className={`bbox ${isSelected ? 'selected' : ''}`}
                style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
                onClick={() => handleBoxTap(det.id)}
                role="button"
                aria-label={`Tap to add ${det.name}`}
              >
                <div className={`bbox-label ${labelFlipped ? 'flipped' : ''}`}>{det.name}</div>
                {!isSelected && (
                  <div className="bbox-tap-hint">
                    <span>tap to add</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Processing indicator */}
        <div className={`processing ${status === 'analyzing' ? 'visible' : ''}`}>
          <div className="spinner" />
          <span>Analyzing room…</span>
        </div>

        {/* Add flash */}
        <div id="add-flash" className="add-flash" />
      </div>

      {/* ── Add prompt ─────────────────────────── */}
      <div
        className={`add-prompt ${selectedDet ? 'visible' : ''}`}
        style={{ bottom: `${promptBottom}px` }}
      >
        {selectedDet && (
          <>
            <div className="prompt-row">
              <div className="prompt-icon">{getEmoji(selectedDet.name, selectedDet.category)}</div>
              <div className="prompt-text">
                <div className="prompt-name">{selectedDet.name}</div>
                <div className="prompt-cat">{selectedDet.category}</div>
                <div className="prompt-badges">
                  <span className="badge badge-vol">📦 ~{getVolume(selectedDet.name, selectedDet.volume_cuft)} cu ft</span>
                  {selectedDet.weight_lb > 0 && (
                    <span className="badge badge-wt">⚖️ ~{selectedDet.weight_lb} lb</span>
                  )}
                  {selectedDet.fragile && <span className="badge badge-fragile">⚠️ Fragile</span>}
                  {selectedDet.heavy && <span className="badge badge-heavy">💪 Heavy</span>}
                  {selectedDet.disassembly_needed && <span className="badge badge-disasm">🔧 Disassembly</span>}
                </div>
              </div>
            </div>
            <div className="prompt-actions">
              <button className="btn-skip" onClick={handleSkip}>✕ Skip</button>
              <button className="btn-add" onClick={handleAdd}>＋ Add to Move</button>
            </div>
          </>
        )}
      </div>

      {/* ── Inventory panel ────────────────────── */}
      <div className={`inv-panel ${panelOpen ? '' : 'collapsed'}`}>
        <div className="inv-handle-zone" onClick={() => setPanelOpen((o) => !o)}>
          <div className="inv-handle" />
          <div className="inv-summary">
            <div className="inv-title">My Inventory</div>
            <div className="inv-chips">
              <span className="inv-count">{totalCount} item{totalCount !== 1 ? 's' : ''}</span>
              <span className="inv-vol">{Math.round(totalVol)} cu ft</span>
            </div>
          </div>
        </div>

        <div className="truck-meter-wrap">
          <div className="truck-meter-labels">
            <span>
              Truck fill · <strong>{suggestedTruck.name}</strong>
            </span>
            <span>{truckPct}%</span>
          </div>
          <div className="truck-meter-track">
            <div className="truck-meter-fill" style={{ width: `${truckPct}%` }} />
          </div>
        </div>

        <div className="items-list">
          {inventory.length === 0 ? (
            <div className="empty-state">
              <p>Point your camera at a room.<br />Tap glowing boxes to add items.</p>
            </div>
          ) : (
            inventory.map((item, idx) => (
              <div key={item.id} className={`item-row ${idx === inventory.length - 1 ? 'new-item' : ''}`}>
                <div className="item-emoji">{item.emoji}</div>
                <div className="item-info">
                  <div className="item-name">{item.name}</div>
                  <div className="item-meta">
                    {item.room} · {item.vol} cu ft
                    {item.fragile && ' · Fragile'}
                    {item.heavy && ' · Heavy'}
                  </div>
                </div>
                <div className="qty-ctrl">
                  <button className="qty-btn" onClick={() => changeQty(item.id, -1)} aria-label="Decrease quantity">−</button>
                  <span className="qty-num">{item.qty}</span>
                  <button className="qty-btn" onClick={() => changeQty(item.id, 1)} aria-label="Increase quantity">+</button>
                </div>
                <button className="rm-btn" onClick={() => removeItem(item.id)} aria-label="Remove item">✕</button>
              </div>
            ))
          )}
        </div>

        {inventory.length > 0 && (
          <div className="inv-actions">
            <button className="inv-action-btn danger" onClick={clearInventory}>
              Clear All
            </button>
            <button className="inv-action-btn" onClick={exportInventory}>
              Export JSON
            </button>
            <button className="inv-action-btn primary" onClick={exportInventory}>
              Get Quote →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
