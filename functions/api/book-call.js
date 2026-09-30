const BOOKING_SERVICE = 'https://chandni-business-os.kinger-siddharth.workers.dev/api/book-call';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function indianWhatsAppNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? `91${local}` : null;
}

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid form.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid form.' }, 400);
  const name = String(body.name || '').trim().slice(0, 100);
  const phone = indianWhatsAppNumber(body.phone);
  const email = String(body.email || '').trim().slice(0, 200);
  const designContext = String(body.designContext || '').trim().slice(0, 100);
  if (!name || !phone || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return json({ error: 'Enter your name and a valid WhatsApp number.' }, 400);
  }

  // Prepare storage first: a calendar event must never be created if its contact
  // number cannot be handed to the WhatsApp agent.
  try {
    await env.CATALOG_DB.prepare(`CREATE TABLE IF NOT EXISTS video_call_bookings (
      code TEXT PRIMARY KEY, wa_id TEXT NOT NULL, customer_name TEXT NOT NULL,
      start_time TEXT NOT NULL, created_at INTEGER NOT NULL
    )`).run();
  } catch { return json({ error: 'Booking is temporarily unavailable.' }, 503); }

  let booked;
  try {
    const upstream = await fetch(BOOKING_SERVICE, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, phone: String(body.phone).trim(), email, designContext }),
    });
    booked = await upstream.json();
    if (!upstream.ok || !booked.success || !booked.startTime) {
      return json({ error: booked.error || 'Could not reserve a time slot.' }, upstream.ok ? 502 : upstream.status);
    }
  } catch { return json({ error: 'Could not reach the booking calendar. Please try again.' }, 502); }

  const code = `BK-${crypto.randomUUID()}`;
  try {
    await env.CATALOG_DB.prepare('INSERT INTO video_call_bookings (code, wa_id, customer_name, start_time, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(code, phone, name, String(booked.startTime), Math.floor(Date.now() / 1000)).run();
  } catch {
    // The external calendar has already created the event. Never tell the buyer
    // to retry and create a duplicate appointment.
    return json({ success: true, startTime: booked.startTime, whatsappReady: false });
  }
  return json({ success: true, startTime: booked.startTime, whatsappReady: true, code });
}
