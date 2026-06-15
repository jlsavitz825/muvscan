import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const buckets = new Map();
const prompt = `Return only JSON. Detect up to 8 move-relevant objects in this room image for a moving estimate. Ignore people, pets, tiny decor, duplicates, and trash. Schema: {"items":[{"name":"short item name","category":"furniture|electronics|appliance|fragile|boxes|misc","bbox":{"x":0,"y":0,"w":0,"h":0},"volume_cuft":1,"weight_lb":1,"fragile":false,"heavy":false,"disassembly_needed":false,"confidence":0.8}]}. bbox values are normalized 0 to 1. If nothing is clear return {"items":[]}.`;

function limit(ip) {
  const max = Number(process.env.SCAN_RATE_LIMIT || 40);
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || b.reset < now) { buckets.set(ip, { count: 1, reset: now + 60000 }); return true; }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}
function clamp(v, min, max, fallback) { v = Number(v); return Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback; }
function clean(item) {
  if (!item || typeof item !== 'object') return null;
  const name = String(item.name || '').trim().slice(0, 70);
  const box = item.bbox || {};
  const x = clamp(box.x, 0, 1, NaN), y = clamp(box.y, 0, 1, NaN), w = clamp(box.w, 0, 1, NaN), h = clamp(box.h, 0, 1, NaN);
  if (!name || ![x,y,w,h].every(Number.isFinite) || w < .03 || h < .03) return null;
  const cats = ['furniture','electronics','appliance','fragile','boxes','misc'];
  return { name, category: cats.includes(item.category) ? item.category : 'misc', bbox: { x, y, w: Math.min(w, 1-x), h: Math.min(h, 1-y) }, volume_cuft: clamp(item.volume_cuft, 1, 500, 12), weight_lb: clamp(item.weight_lb, 1, 2000, 25), fragile: !!item.fragile, heavy: !!item.heavy, disassembly_needed: !!item.disassembly_needed, confidence: clamp(item.confidence, 0, 1, .5) };
}

export async function POST(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  if (!limit(ip)) return NextResponse.json({ items: [], error: 'Rate limit reached.' }, { status: 429 });
  const key = process.env['ANTHROPIC' + '_API_KEY'];
  if (!key) return NextResponse.json({ items: [], error: 'Server missing vision key.' }, { status: 500 });
  let image = '';
  try { image = (await req.json()).image || ''; } catch { return NextResponse.json({ items: [], error: 'Invalid request.' }, { status: 400 }); }
  if (typeof image !== 'string' || image.length < 1000) return NextResponse.json({ items: [], error: 'Missing image.' }, { status: 400 });
  if (image.length > 5800000) return NextResponse.json({ items: [], error: 'Image too large.' }, { status: 413 });

  const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514', max_tokens: 1000, temperature: .1, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } }, { type: 'text', text: prompt }] }] }) });
  if (!res.ok) return NextResponse.json({ items: [], error: 'Vision scan failed.' }, { status: res.status === 429 ? 429 : 502 });
  const data = await res.json();
  const text = data.content?.find(p => p.type === 'text')?.text || '';
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const items = Array.isArray(json.items) ? json.items.map(clean).filter(Boolean).filter(i => i.confidence >= .45).slice(0, 8) : [];
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
