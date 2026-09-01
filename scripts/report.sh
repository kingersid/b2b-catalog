#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Chandni Silk Mills — Catalog Analytics Report Generator
#  Queries production D1 and prints a formatted day-wise report.
#
#  Usage:  bash scripts/report.sh
#  Or ask: "generate dashboard report"
# ─────────────────────────────────────────────────────────────
set -euo pipefail

DB="chandni-catalog"
R="--remote"

# Helper: run a D1 query, extract JSON results array, pipe to node for processing
# Usage: query "SQL" "node script"
query() {
  local sql="$1"
  npx wrangler d1 execute $DB $R --command "$sql" 2>/dev/null \
    | sed -n '/^\[/,/^]/p' \
    | node -e "
      let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
        try {
          const rows = JSON.parse(b)[0]?.results || [];
          process.stdout.write(JSON.stringify(rows));
        } catch(e) { process.stdout.write('[]'); }
      });"
}

# Helper: single scalar query → echo value
scalar() {
  local sql="$1"
  query "$sql" | node -e "
    let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
      const rows = JSON.parse(b);
      console.log(rows[0] ? Object.values(rows[0])[0] : 0);
    });"
}

# ── Header ───────────────────────────────────────────────────
echo ""
echo "## 📊 Chandni Silk Mills — Catalog Analytics Report"
echo "**Live data as of $(TZ=Asia/Kolkata date '+%B %d, %Y %l:%M %p IST')**"
echo ""

# ── 1. Overview ──────────────────────────────────────────────
echo "### 🔢 Catalog Overview"
echo "| Metric | Value |"
echo "|--------|-------|"

TOTAL_DESIGNS=$(scalar "SELECT COUNT(*) as c FROM designs;")
PRICED=$(scalar "SELECT COUNT(*) as c FROM designs d JOIN prices p ON d.design_id = p.item_id;")
UNPRICED=$((TOTAL_DESIGNS - PRICED))
MIN_PRICE=$(scalar "SELECT MIN(price) as c FROM prices;")
MAX_PRICE=$(scalar "SELECT MAX(price) as c FROM prices;")

echo "| **Total Designs** | $TOTAL_DESIGNS (all active) |"
echo "| **Designs with Prices** | $PRICED ($UNPRICED missing) |"
echo "| **Price Range** | ₹$MIN_PRICE – ₹$MAX_PRICE |"
echo ""

# ── 2. Daily Visits ──────────────────────────────────────────
echo "### 📅 Daily Visits (IST)"
echo ""
echo '```'
printf "%-14s %6s   %s\n" "Date" "Visits" "Bar"
echo "─────────────────────────────────────────────────────────────"

query "SELECT day, count FROM visits ORDER BY day;" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    if (!rows.length) { console.log('(no data)'); return; }
    const maxC = Math.max(...rows.map(r=>r.count), 1);
    const total = rows.reduce((s,r)=>s+r.count,0);
    rows.forEach(r => {
      const bar = '█'.repeat(Math.round(r.count / maxC * 50));
      const d = new Date(r.day + 'T00:00:00+05:30');
      const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const label = months[d.getMonth()]+' '+d.getDate()+' ('+days[d.getDay()]+')';
      console.log(label.padEnd(14) + String(r.count).padStart(6) + '   ' + bar);
    });
    console.log('─────────────────────────────────────────────────────────────');
    console.log('TOTAL (' + rows.length + ' days):  ' + total + ' visits');
    console.log('DAILY AVG:               ' + Math.round(total/rows.length) + ' visits/day');
  });"
echo '```'
echo ""

# ── 3. Traffic Sources (day-wise) ────────────────────────────
echo "### 🚦 Traffic Sources (day-wise)"
echo ""
echo "| Date | Direct | Bing | Instagram | Other |"
echo "|------|--------|------|-----------|-------|"

query "SELECT day, source, count FROM sources ORDER BY day DESC;" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    if (!rows.length) { console.log('| (no data) | — | — | — | — |'); return; }
    const byDay = {};
    rows.forEach(r => {
      if (!byDay[r.day]) byDay[r.day] = {};
      byDay[r.day][r.source||'direct'] = r.count;
    });
    Object.keys(byDay).sort().reverse().forEach(day => {
      const s = byDay[day];
      const dir = s['direct'] || 0;
      const bing = (s['www.bing.com']||0) + (s['bing']||0);
      const ig = (s['instagram']||0) + (s['l.instagram.com']||0);
      let other = 0;
      for (const [k,v] of Object.entries(s)) {
        if (!['direct','www.bing.com','bing','instagram','l.instagram.com'].includes(k)) other += v;
      }
      console.log('| ' + day + ' | ' + dir + ' | ' + bing + ' | ' + ig + ' | ' + other + ' |');
    });
  });"
echo ""

# Source totals
echo "**Source totals:**"
TOTAL_VISITS_COUNT=$(scalar "SELECT SUM(count) as c FROM visits;")
query "SELECT source, SUM(count) as c FROM sources GROUP BY source ORDER BY c DESC;" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    const grand = rows.reduce((s,r)=>s+r.c,0) || 1;
    rows.forEach(r => {
      const src = r.source || '(direct)';
      const pct = Math.round(r.c * 100 / grand);
      console.log('- **' + src + ':** ' + r.c + ' (' + pct + '%)');
    });
  });"
echo ""

# ── 4. WhatsApp CTA Clicks ───────────────────────────────────
echo "### 💬 WhatsApp CTA Clicks (all-time)"
echo ""
echo "| Design | Clicks |"
echo "|--------|--------|"

CTA_JSON=$(query "SELECT item_id, count FROM cta ORDER BY count DESC;")
echo "$CTA_JSON" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    rows.slice(0,15).forEach(r => {
      console.log('| ' + r.item_id.slice(0,20) + ' | ' + r.count + ' |');
    });
  });"

TOTAL_CTA=$(echo "$CTA_JSON" | node -e "let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{const r=JSON.parse(b);console.log(r.reduce((s,x)=>s+x.count,0))})")
echo ""
echo "**Total CTA clicks: $TOTAL_CTA**"
echo ""

# ── 4b. Day-wise CTA Clicks ──────────────────────────────────
echo "### 📅 WhatsApp CTA Clicks (day-wise, last 14 days)"
echo ""
echo "| Date | Clicks | Designs |"
echo "|------|--------|---------|"

query "SELECT day, item_id, COUNT(*) as clicks FROM cta_events GROUP BY day, item_id ORDER BY day DESC;" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    if (!rows.length) { console.log('| (no data) | — | — |'); return; }
    const byDay = {};
    rows.forEach(r => {
      if (!byDay[r.day]) byDay[r.day] = { total: 0, designs: 0 };
      byDay[r.day].total += r.clicks;
      byDay[r.day].designs += 1;
    });
    Object.keys(byDay).sort().reverse().slice(0,14).forEach(day => {
      const s = byDay[day];
      console.log('| ' + day + ' | ' + s.total + ' | ' + s.designs + ' |');
    });
  });"
echo ""

# ── 5. Hearts ────────────────────────────────────────────────
echo "### ❤️ Hearts (Likes)"
echo ""
echo "| Design | Hearts |"
echo "|--------|--------|"

HEARTS_JSON=$(query "SELECT item_id, count FROM hearts ORDER BY count DESC;")
echo "$HEARTS_JSON" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    rows.slice(0,10).forEach(r => {
      console.log('| ' + r.item_id.slice(0,20) + ' | ' + r.count + ' |');
    });
  });"

TOTAL_HEARTS=$(echo "$HEARTS_JSON" | node -e "let b='';process.stdin.on('data',d=>b+=d);process.stdin.on('end',()=>{const r=JSON.parse(b);console.log(r.reduce((s,x)=>s+x.count,0))})")
echo ""
echo "**Total hearts: $TOTAL_HEARTS** across designs."
echo ""

# ── 6. Scroll Depth / Reach ──────────────────────────────────
echo "### 📏 Scroll Depth (Reach)"
echo ""
echo '```'
printf "%-12s" "Date"
for ((d=1; d<=10; d++)); do printf " %6s" "D$d"; done
echo ""
echo "─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────"

query "SELECT day, depth, count FROM reach ORDER BY day, depth;" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    if (!rows.length) { console.log('(no data)'); return; }
    const byDay = {};
    rows.forEach(r => {
      if (!byDay[r.day]) byDay[r.day] = {};
      byDay[r.day][r.depth] = r.count;
    });
    Object.keys(byDay).sort().forEach(day => {
      let line = day.padEnd(12);
      for (let dep=1; dep<=10; dep++) {
        line += ((byDay[day][dep] ?? '-')+'').padStart(6);
      }
      console.log(line);
    });
  });"
echo '```'
echo ""

# ── 7. Top Designs (engagement composite) ────────────────────
echo "### 🏆 Top Designs by Engagement"
echo ""
echo "| # | Design | Hearts | CTA | Price | Score |"
echo "|---|--------|--------|-----|-------|-------|"

query "SELECT d.design_id, COALESCE(h.count,0) as hearts, COALESCE(c.count,0) as clicks, p.price FROM designs d LEFT JOIN hearts h ON d.design_id = h.item_id LEFT JOIN cta c ON d.design_id = c.item_id LEFT JOIN prices p ON d.design_id = p.item_id ORDER BY (COALESCE(h.count,0) + COALESCE(c.count,0)) DESC LIMIT 10;" | node -e "
  let b=''; process.stdin.on('data',d=>b+=d); process.stdin.on('end',()=>{
    const rows = JSON.parse(b);
    rows.forEach((r,i) => {
      const score = (r.hearts||0)*2 + (r.clicks||0);
      console.log('| ' + (i+1) + ' | ' + r.design_id.slice(0,20) + '… | ' + (r.hearts||0) + ' | ' + (r.clicks||0) + ' | ₹' + (r.price||'—') + ' | ' + score + ' |');
    });
    if (!rows.length) console.log('| — | (no data) | — | — | — | — |');
  });"
echo ""

# ── 8. Recommendations ──────────────────────────────────────
DAILY_AVG=0
[ "$TOTAL_DESIGNS" -gt 0 ] && [ "$TOTAL_VISITS_COUNT" -gt 0 ] && DAILY_AVG=$((TOTAL_VISITS_COUNT / TOTAL_DESIGNS))

echo "### ⚡ Recommendations"
echo ""
echo "1. **$UNPRICED designs have no price** — add prices to avoid friction."
echo "2. **$TOTAL_HEARTS total hearts** — low engagement; consider making ❤️ more visible."
echo "3. **$TOTAL_CTA total CTA clicks** — track which designs drive WhatsApp inquiries."
echo "4. **$TOTAL_VISITS_COUNT total visits across all days** — monitor trend over time."
echo ""
echo "---"
echo "*Report generated by \`scripts/report.sh\`*"
