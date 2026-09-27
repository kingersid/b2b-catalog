const OWNER = '919537097267';
const CAPTURE_SECONDS = 60 * 60;
const dayInIndia = date => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

export function orderIntent(text, contextId = '') {
  const value = String(text || '').trim();
  const complete = /^(?:completed|complete|done)\s*(?:#|order\s*#?)?\s*(\d+)?[.!\s]*$/i.exec(value);
  if (complete) return { kind: 'complete', id: complete[1] ? Number(complete[1]) : null, contextId };
  if (/^(?:pending|pending orders|orders pending|list orders)[.!\s]*$/i.test(value)) return { kind: 'list' };
  if (/^(?:end order|finish order)[.!\s]*$/i.test(value)) return { kind: 'end' };
  if (/(?:^|\b)(?:pls\s+|please\s+)?(?:note\s+(?:this\s+|an?\s+)?order|new\s+order|order\s*[:#-])/i.test(value)) return { kind: 'start' };
  return { kind: 'append' };
}

function fields(text) {
  const party = /(?:^|[.\n,;])\s*(?:party|customer|client)(?:\s+name)?\s*[:=-]\s*([^\n,;.]+)/i.exec(text)?.[1]?.trim().slice(0, 120) || null;
  const location = /(?:^|[.\n,;])\s*(?:location|city|place|address)\s*[:=-]\s*([^\n,;.]+)/i.exec(text)?.[1]?.trim().slice(0, 160) || null;
  return { party, location };
}

function summary(order) {
  const bits = [`#${order.id}`];
  if (order.party) bits.push(order.party);
  if (order.location) bits.push(order.location);
  const note = String(order.notes || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (note) bits.push(note);
  if (Number(order.image_count || 0)) bits.push(`${order.image_count} photo${order.image_count === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

async function pendingOrders(env) {
  const { results } = await env.CATALOG_DB.prepare(`SELECT o.id, o.party, o.location, o.notes,
    (SELECT COUNT(*) FROM wa_order_items i WHERE i.order_id = o.id AND i.kind = 'image') AS image_count
    FROM wa_orders o WHERE o.status = 'pending' ORDER BY o.created_at, o.id`).all();
  return results;
}

export async function pendingText(env, forTemplate = false) {
  const orders = await pendingOrders(env);
  if (!orders.length) return 'No pending orders.';
  const lines = forTemplate ? [] : [`Pending orders (${orders.length}):`];
  let omitted = 0;
  for (const order of orders) {
    const line = summary(order);
    if (lines.join('\n').length + line.length > (forTemplate ? 780 : 1150)) { omitted++; continue; }
    lines.push(line);
  }
  if (omitted) lines.push(`...and ${omitted} more. Open the operator inbox for the full list.`);
  if (!forTemplate) lines.push('Reply COMPLETED <order number> (for example, COMPLETED 12) when finished.');
  return lines.join('\n');
}

export async function handleOwnerOrder(env, row, { downloadMedia }) {
  if (row.wa_id !== OWNER) return null;
  const stamp = Math.floor(Date.now() / 1000);
  const context = await env.CATALOG_DB.prepare('SELECT replied_to_message_id FROM wa_order_context WHERE message_id = ?')
    .bind(row.message_id).first();
  const intent = orderIntent(row.body, context?.replied_to_message_id);
  if (intent.kind === 'list') return { text: await pendingText(env) };
  if (intent.kind === 'complete') {
    let id = intent.id;
    if (!id && intent.contextId) {
      const linked = await env.CATALOG_DB.prepare('SELECT order_id FROM wa_order_outbound WHERE graph_message_id = ?')
        .bind(intent.contextId).first();
      id = linked?.order_id;
    }
    if (!id) {
      const { results } = await env.CATALOG_DB.prepare("SELECT id FROM wa_orders WHERE status = 'pending' ORDER BY id").all();
      if (results.length === 1) id = results[0].id;
    }
    if (!id) return { text: 'Please reply COMPLETED followed by the order number, for example COMPLETED 12.' };
    const result = await env.CATALOG_DB.prepare("UPDATE wa_orders SET status = 'completed', completed_at = ?, updated_at = ?, capture_until = ? WHERE id = ? AND sender = ? AND status = 'pending'")
      .bind(stamp, stamp, stamp, id, OWNER).run();
    return { text: result.meta.changes ? `Order #${id} marked completed.` : `Order #${id} is not pending.` };
  }
  if (intent.kind === 'end') {
    const active = await env.CATALOG_DB.prepare("SELECT id FROM wa_orders WHERE sender = ? AND status = 'pending' AND capture_until >= ? ORDER BY id DESC LIMIT 1")
      .bind(OWNER, stamp).first();
    if (!active) return { text: 'No order is currently being collected.' };
    await env.CATALOG_DB.prepare('UPDATE wa_orders SET capture_until = ?, updated_at = ? WHERE id = ?').bind(stamp - 1, stamp, active.id).run();
    return { text: `Order #${active.id} saved. It will appear in the noon pending list.` };
  }
  let order;
  if (intent.kind === 'start') {
    const f = fields(row.body);
    await env.CATALOG_DB.prepare('INSERT OR IGNORE INTO wa_orders (start_message_id, sender, notes, party, location, created_at, updated_at, capture_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(row.message_id, OWNER, row.body, f.party, f.location, stamp, stamp, stamp + CAPTURE_SECONDS).run();
    order = await env.CATALOG_DB.prepare('SELECT id FROM wa_orders WHERE start_message_id = ?').bind(row.message_id).first();
  } else {
    order = await env.CATALOG_DB.prepare("SELECT id FROM wa_orders WHERE sender = ? AND status = 'pending' AND capture_until >= ? ORDER BY id DESC LIMIT 1")
      .bind(OWNER, stamp).first();
  }
  if (!order) return { text: 'To record an order, send “Please note this order” with the party and location, then send its photos and details within one hour.' };
  let r2Key = null;
  let mime = null;
  if (row.media_kind === 'image') {
    const media = await downloadMedia(env, row.media_id, 'image');
    mime = media.mime;
    r2Key = `wa-orders/${order.id}/${encodeURIComponent(row.message_id)}.${mime === 'image/png' ? 'png' : 'jpg'}`;
    await env.ORDER_IMAGES.put(r2Key, media.bytes, { httpMetadata: { contentType: mime } });
  }
  const isStart = intent.kind === 'start';
  const inserted = await env.CATALOG_DB.prepare('INSERT OR IGNORE INTO wa_order_items (message_id, order_id, kind, text, r2_key, mime, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(row.message_id, order.id, row.media_kind === 'image' ? 'image' : 'text', row.body, r2Key, mime, stamp).run();
  if (!inserted.meta.changes) return { text: null };
  if (!isStart) {
    const f = fields(row.body);
    const note = row.body.startsWith('[Customer sent a image') ? null : row.body;
    await env.CATALOG_DB.prepare("UPDATE wa_orders SET notes = CASE WHEN ? IS NULL THEN notes ELSE substr(notes || char(10) || ?, 1, 3000) END, party = COALESCE(?, party), location = COALESCE(?, location), updated_at = ?, capture_until = ? WHERE id = ?")
      .bind(note, note, f.party, f.location, stamp, stamp + CAPTURE_SECONDS, order.id).run();
  }
  return { text: isStart ? `Order #${order.id} saved. Send its images and remaining details now; reply END ORDER when finished.` : null, orderId: isStart ? order.id : null };
}

export async function sendNoonOrderReminder(env, sendWhatsApp, date = new Date()) {
  const indiaTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  if (!/^12:(?:[0-2]\d|30)$/.test(indiaTime)) return { skipped: 'outside noon window' };
  const day = dayInIndia(date);
  const orders = await pendingOrders(env);
  if (!orders.length) return { skipped: 'no pending orders' };
  const claimed = await env.CATALOG_DB.prepare("INSERT OR IGNORE INTO wa_order_reminders (day, status) VALUES (?, 'sending')").bind(day).run();
  if (!claimed.meta.changes) return { skipped: 'already attempted today' };
  const latest = await env.CATALOG_DB.prepare('SELECT last_customer_at FROM wa_conversations WHERE wa_id = ?').bind(OWNER).first();
  const withinWindow = Number(latest?.last_customer_at || 0) >= Math.floor(date.getTime() / 1000) - 23 * 3600 - 50 * 60;
  const text = await pendingText(env, !withinWindow);
  let payload;
  if (withinWindow) {
    payload = { messaging_product: 'whatsapp', to: OWNER, type: 'text', text: { body: text } };
  } else {
    if (!env.ORDER_REMINDER_TEMPLATE) {
      await env.CATALOG_DB.prepare("UPDATE wa_order_reminders SET status = 'failed', last_error = 'Approved template not configured' WHERE day = ?").bind(day).run();
      return { error: 'Approved template not configured' };
    }
    payload = { messaging_product: 'whatsapp', to: OWNER, type: 'template', template: {
      name: env.ORDER_REMINDER_TEMPLATE, language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text }] }]
    } };
  }
  try {
    const graphId = await sendWhatsApp(env, payload);
    await env.CATALOG_DB.prepare("UPDATE wa_order_reminders SET status = 'sent', sent_at = ?, graph_message_id = ? WHERE day = ?")
      .bind(Math.floor(Date.now() / 1000), graphId, day).run();
    return { sent: true, count: orders.length, template: !withinWindow };
  } catch (error) {
    await env.CATALOG_DB.prepare("UPDATE wa_order_reminders SET status = 'failed', last_error = ? WHERE day = ?")
      .bind(String(error.message).slice(0, 200), day).run();
    return { error: String(error.message).slice(0, 200) };
  }
}
