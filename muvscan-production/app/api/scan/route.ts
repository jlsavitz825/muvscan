// Server-side scan endpoint. Receives a base64 JPEG from the client,
// forwards it to Claude Vision, and returns parsed item detections.
//
// SECURITY: this is the only place the ANTHROPIC_API_KEY is read.
// The key never reaches the browser. Do not import this prompt or
// the SDK from client components.

import Anthropic from '@anthropic-ai/sdk';
import { NextRequest, NextResponse } from 'next/server';
import { SCAN_PROMPT } from '@/lib/prompt';
import type { ApiDetection, ScanApiResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Simple in-memory IP-based rate limiting.
// Survives within a single serverless instance; resets on cold start.
// For higher-traffic production, swap for Upstash Redis or Vercel KV.
const RATE_LIMIT = Number(process.env.SCAN_RATE_LIMIT ?? 60); // per minute
const buckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return { ok: true, remaining: RATE_LIMIT - 1 };
  }
  if (bucket.count >= RATE_LIMIT) return { ok: false, remaining: 0 };
  bucket.count += 1;
  return { ok: true, remaining: RATE_LIMIT - bucket.count };
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

// Defensive validation: make sure Claude's output matches our expected shape
// before handing it to the client.
function validateItem(raw: unknown): ApiDetection | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.name !== 'string' || o.name.length === 0 || o.name.length > 80) return null;
  if (typeof o.bbox !== 'object' || o.bbox === null) return null;

  const bb = o.bbox as Record<string, unknown>;
  const x = Number(bb.x), y = Number(bb.y), w = Number(bb.w), h = Number(bb.h);
  if (![x, y, w, h].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  if (w === 0 || h === 0) return null;

  const conf = Number(o.confidence);
  if (!Number.isFinite(conf) || conf < 0.5) return null;

  const allowedCats = ['furniture', 'electronics', 'appliance', 'fragile', 'boxes', 'misc'];
  const category = allowedCats.includes(o.category as string) ? (o.category as ApiDetection['category']) : 'misc';

  return {
    name: (o.name as string).slice(0, 80),
    category,
    bbox: { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) },
    volume_cuft: Math.max(1, Math.min(500, Number(o.volume_cuft) || 0)),
    weight_lb: Math.max(1, Math.min(2000, Number(o.weight_lb) || 0)),
    fragile: !!o.fragile,
    heavy: !!o.heavy,
    disassembly_needed: !!o.disassembly_needed,
    confidence: Math.max(0, Math.min(1, conf)),
  };
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-20250514';

export async function POST(req: NextRequest) {
  // Rate limit
  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many scans. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  // Key check
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Server not configured. Missing ANTHROPIC_API_KEY.' },
      { status: 500 }
    );
  }

  // Parse request body
  let body: { image?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const image = body.image;
  if (typeof image !== 'string' || image.length === 0) {
    return NextResponse.json({ error: 'Missing image data.' }, { status: 400 });
  }
  if (image.length > 6_500_000) {
    return NextResponse.json({ error: 'Image too large. Compress and retry.' }, { status: 413 });
  }

  // Call Claude
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: image },
            },
            { type: 'text', text: SCAN_PROMPT },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json<ScanApiResponse>({ items: [] });
    }

    // Extract the JSON object from Claude's response
    const match = textBlock.text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json<ScanApiResponse>({ items: [] });

    let parsed: { items?: unknown };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      console.error('JSON parse error from Claude output:', textBlock.text.slice(0, 500));
      return NextResponse.json<ScanApiResponse>({ items: [] });
    }

    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const items: ApiDetection[] = rawItems
      .map(validateItem)
      .filter((item): item is ApiDetection => item !== null)
      .slice(0, 8);

    return NextResponse.json<ScanApiResponse>(
      { items },
      { headers: { 'X-RateLimit-Remaining': String(rl.remaining) } }
    );
  } catch (err) {
    const error = err as { status?: number; message?: string };
    console.error('Anthropic call failed:', error.status, error.message);

    // Surface the right HTTP status to the client
    if (error.status === 429) {
      return NextResponse.json(
        { error: 'Vision service is busy. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': '5' } }
      );
    }
    if (error.status === 401 || error.status === 403) {
      return NextResponse.json(
        { error: 'Server authentication failed. Check ANTHROPIC_API_KEY.' },
        { status: 500 }
      );
    }
    return NextResponse.json(
      { error: 'Vision scan failed. Please retry.' },
      { status: 502 }
    );
  }
}
