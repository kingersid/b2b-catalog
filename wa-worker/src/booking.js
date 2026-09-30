export function bookingCode(message) {
  return String(message || '').match(/\bBK-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0] || null;
}

export function bookingReply(booking) {
  const hasZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(booking.start_time);
  const date = new Date(booking.start_time);
  const when = !hasZone || Number.isNaN(date.getTime()) ? booking.start_time : new Intl.DateTimeFormat('hi-IN', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date);
  const firstName = booking.customer_name.split(/\s+/)[0];
  return `${firstName} जी, वीडियो कॉल बुक करने के लिए धन्यवाद। हम केवल व्यवसाय के लिए थोक में कपड़े देते हैं (कम से कम 20 मीटर प्रति डिज़ाइन)। कृपया बताइए, आप अपने व्यवसाय के लिए खरीद रहे हैं या निजी उपयोग के लिए? आपकी कॉल ${when} पर बुक है—क्या यह समय आपके लिए सुविधाजनक है?`;
}

export async function bookedCallForMessage(env, message, waId) {
  const code = bookingCode(message);
  if (!code) return null;
  try {
    const booking = await env.CATALOG_DB.prepare('SELECT customer_name, start_time, wa_id FROM video_call_bookings WHERE code = ?')
      .bind(code).first();
    return booking && booking.wa_id === waId ? booking : null;
  } catch (error) {
    if (/no such table/i.test(String(error))) return null;
    throw error;
  }
}
