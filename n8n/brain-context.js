const request = $('Parse Message').first().json;
const catalog = $('Get Active Designs').first().json.designs || [];
const prices = $json.prices || {};
const stem = name => String(name || '').replace(/\.[^.]+$/, '');
const priceFor = design => {
  const name = String(design.name || '');
  const id = String(design.design_id || '');
  for (const key of [id, name, stem(name), id.toLowerCase(), name.toLowerCase(), stem(name).toLowerCase()]) {
    if (key && Object.prototype.hasOwnProperty.call(prices, key) && Number(prices[key]) > 0) return Number(prices[key]);
  }
  return null;
};
const eligible = catalog.map(d => ({ ...d, rate: priceFor(d) }))
  .filter(d => d.rate !== null && d.design_id && d.url);
return [{ json: {
  request,
  eligible,
  // The model gets only public identifiers and names. Rates and the sender's number stay in n8n.
  modelInput: {
    message: request.text.slice(0, 1500),
    designs: eligible.slice(0, 100).map(d => ({ id: String(d.design_id), name: String(d.name || '') }))
  }
} }];
