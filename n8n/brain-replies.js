const context = $('Build AI Context').first().json;
const { request, eligible } = context;
const textPayload = body => ({ messaging_product: 'whatsapp', to: request.sender, type: 'text', text: { body } });
const asItems = payloads => payloads.map(payload => ({ json: { payload } }));

let decision;
try {
  const response = $json;
  const answer = (response.output || []).flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text').map(part => part.text).join('');
  decision = JSON.parse(answer);
} catch (_) {
  decision = null;
}

const allowed = new Map(eligible.map(d => [String(d.design_id), d]));
const action = decision?.action;
if (action === 'stop') return [];
if (action === 'handoff') {
  return asItems([textPayload('I will ask our team to help you. Please share your requirement and a salesperson will follow up.')]);
}
if (action === 'clarify') {
  const question = {
    fabric: 'Which fabric are you looking for?',
    color: 'Which colour would you like?',
    quantity: 'What quantity do you need?',
    general: 'Please tell me the fabric, colour, or design you need, and I will check our catalog.'
  }[decision?.question] || 'Please tell me the fabric, colour, or design you need, and I will check our catalog.';
  return asItems([textPayload(question)]);
}

// A model failure falls back to the currently available designs. It cannot create an item or rate.
const ids = Array.isArray(decision?.design_ids) ? decision.design_ids : [];
const selected = [...new Set(ids.map(String))].map(id => allowed.get(id)).filter(Boolean).slice(0, 3);
if (!selected.length) selected.push(...eligible.slice(0, 3));
if (!selected.length) return asItems([textPayload('New designs are being updated. Please ask for a salesperson.')]);
return asItems(selected.map((design, index) => ({
  messaging_product: 'whatsapp', to: request.sender, type: 'image',
  image: {
    link: design.url,
    caption: `Design ${index + 1} · ₹${design.rate.toLocaleString('en-IN')}\nView: https://chandni-catalog.pages.dev/share?id=${encodeURIComponent(design.design_id)}\nReply with your fabric, colour or quantity to narrow the selection.`
  }
})));
