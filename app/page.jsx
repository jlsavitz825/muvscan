'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const rooms = ['Living Room', 'Bedroom', 'Kitchen', 'Office', 'Dining Room', 'Garage'];
const trucks = [
  ['Cargo van', 250], ['10 ft truck', 400], ['15 ft truck', 750], ['20 ft truck', 1000], ['26 ft truck', 1700]
];
const storeKey = 'muv-vision.inventory.v3';

function truckFor(cuft) {
  const hit = trucks.find(([, cap]) => cuft <= cap);
  return hit ? hit[0] : 'Multiple 26 ft trucks';
}

function titleCase(s) { return String(s || '').replace(/\b\w/g, c => c.toUpperCase()); }
function id() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function downloadJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `muv-vision-estimate-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function capture(video, canvas, width = 900) {
  const h = Math.round(width * video.videoHeight / video.videoWidth);
  canvas.width = width; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, h);
  return { ctx, dataUrl: canvas.toDataURL('image/jpeg', 0.76) };
}

function motionScore(ctx, prevRef) {
  const w = 96, h = 54;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(ctx.canvas, 0, 0, w, h);
  const now = x.getImageData(0, 0, w, h);
  if (!prevRef.current) { prevRef.current = now; return 100; }
  let total = 0;
  for (let i = 0; i < now.data.length; i += 20) total += Math.abs(now.data[i] - prevRef.current.data[i]);
  prevRef.current = now;
  return total / (now.data.length / 20);
}

export default function Page() {
  const [room, setRoom] = useState(rooms[0]);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [review, setReview] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const prevRef = useRef(null);
  const quietRef = useRef(0);
  const lastScanRef = useRef(0);

  useEffect(() => { try { setInventory(JSON.parse(localStorage.getItem(storeKey) || '[]')); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(inventory)); } catch {} }, [inventory]);
  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), []);

  const totals = useMemo(() => {
    const volume = inventory.reduce((n, i) => n + i.volume_cuft * i.qty, 0);
    const weight = inventory.reduce((n, i) => n + i.weight_lb * i.qty, 0);
    return { volume, weight, truck: truckFor(volume), fragile: inventory.filter(i => i.fragile).length };
  }, [inventory]);

  async function startCamera() {
    setError(''); setStatus('Starting camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setReady(true); setStatus('Camera ready');
    } catch (e) {
      setError('Camera blocked or unavailable. Allow camera access and reload.');
      setStatus('Camera blocked');
    }
  }

  async function scan(force = false) {
    if (!ready || busy || !videoRef.current?.videoWidth) return;
    if (!force && Date.now() - lastScanRef.current < 3500) return;
    setBusy(true); setStatus('Analyzing'); lastScanRef.current = Date.now();
    try {
      const { dataUrl } = capture(videoRef.current, canvasRef.current);
      const res = await fetch('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: dataUrl.split(',')[1] }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Scan failed');
      const existing = new Set(inventory.filter(i => i.room === room).map(i => i.name.toLowerCase()));
      const fresh = (body.items || []).filter(i => !existing.has(i.name.toLowerCase())).map(i => ({ ...i, id: id(), room, shot: dataUrl }));
      setReview(fresh); setStatus(fresh.length ? `${fresh.length} item(s) found` : 'No new items');
    } catch (e) {
      setError(e.message || 'Scan failed'); setStatus('Scan failed');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!auto || !ready) return;
    let raf;
    const tick = () => {
      try {
        const { ctx } = capture(videoRef.current, canvasRef.current, 260);
        const m = motionScore(ctx, prevRef);
        quietRef.current = m < 8 ? quietRef.current + 1 : 0;
        setStatus(m < 8 ? 'Stable — ready' : 'Hold still');
        if (quietRef.current >= 4) { quietRef.current = 0; scan(false); }
      } catch {}
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [auto, ready, room, inventory]);

  function add(item) {
    setInventory([{ ...item, name: titleCase(item.name), qty: 1, addedAt: new Date().toISOString() }, ...inventory]);
    setReview(review.filter(i => i.id !== item.id));
  }

  function addAll() {
    setInventory([...review.map(i => ({ ...i, name: titleCase(i.name), qty: 1, addedAt: new Date().toISOString() })), ...inventory]);
    setReview([]);
  }

  function setQty(id, d) { setInventory(inventory.map(i => i.id === id ? { ...i, qty: Math.max(1, i.qty + d) } : i)); }
  function remove(id) { setInventory(inventory.filter(i => i.id !== id)); }

  return <main className="shell">
    <section className="cameraPanel">
      <header><div className="brand"><b>M</b><span><strong>MÜV Vision Scanner</strong><small>Room-to-inventory AI for moving estimates</small></span></div><em>{status}</em></header>
      <div className="camera">
        <video ref={videoRef} playsInline muted autoPlay />
        {!ready && <div className="overlay"><h1>MÜV Vision</h1><p>Camera-first inventory capture for faster MÜV estimates.</p><button onClick={startCamera}>Start camera</button>{error && <p className="err">{error}</p>}</div>}
        {review.map(item => <button key={item.id} className="box" onClick={() => add(item)} style={{ left: `${item.bbox.x*100}%`, top: `${item.bbox.y*100}%`, width: `${item.bbox.w*100}%`, height: `${item.bbox.h*100}%` }}><span>{titleCase(item.name)}</span></button>)}
      </div>
      <canvas ref={canvasRef} hidden />
      <div className="controls"><select value={room} onChange={e => setRoom(e.target.value)}>{rooms.map(r => <option key={r}>{r}</option>)}</select><button onClick={() => scan(true)} disabled={!ready || busy}>Scan now</button><button className="primary" onClick={() => setAuto(!auto)} disabled={!ready}>{auto ? 'Pause auto' : 'Start auto'}</button></div>
      {review.length > 0 && <div className="review"><strong>Review before adding</strong><button onClick={addAll}>Add all</button><button onClick={() => setReview([])}>Dismiss</button></div>}
    </section>
    <aside>
      <div className="metrics"><article><b>{inventory.length}</b><small>Items</small></article><article><b>{Math.round(totals.volume)}</b><small>Cu ft</small></article><article><b>{Math.round(totals.weight)}</b><small>Lb</small></article></div>
      <div className="truck"><small>Truck estimate</small><h2>{totals.truck}</h2><p>{totals.fragile} fragile item(s)</p></div>
      <div className="controls"><button onClick={() => downloadJson({ totals, inventory })} disabled={!inventory.length}>Export JSON</button><button onClick={() => setInventory([])} disabled={!inventory.length}>Clear</button></div>
      <div className="list">{inventory.length === 0 && <p className="empty">No items yet. Start camera and scan.</p>}{inventory.map(item => <article key={item.id} className="item"><div><strong>{item.name}</strong><small>{item.room} · {Math.round(item.volume_cuft)} cu ft · {Math.round(item.weight_lb)} lb</small></div><div><button onClick={() => setQty(item.id, -1)}>−</button><span>{item.qty}</span><button onClick={() => setQty(item.id, 1)}>+</button><button onClick={() => remove(item.id)}>×</button></div></article>)}</div>
    </aside>
    {error && ready && <div className="toast">{error}</div>}
  </main>;
}
