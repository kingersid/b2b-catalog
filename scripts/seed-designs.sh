#!/bin/bash
# Seed existing 51 images into R2 + D1 designs table
# Run from repo root: bash scripts/seed-designs.sh

set -e

BUCKET="chandni-catalog-assets"
DB="chandni-catalog"
echo "Seeding designs..."

# Collect all JPG/JPEG files in root (not in subdirectories)
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find . -maxdepth 1 \( -iname "*.jpg" -o -iname "*.jpeg" \) -print0 | sort -z)

echo "Found ${#FILES[@]} images"

# SQL batch for D1
SQL=""

for f in "${FILES[@]}"; do
  # Strip leading ./
  fname="${f#./}"
  # Stem: lowercase, no extension
  stem=$(echo "$fname" | sed 's/\.[^.]*$//' | tr '[:upper:]' '[:lower:]')
  ext="${fname##*.}"
  ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
  
  echo "→ $fname (id: $stem)"
  
  # Upload to R2
  npx wrangler r2 object put "$BUCKET" "designs/original/${stem}.jpg" --file="$fname" 2>&1 | tail -1
  
  # Escape single quotes for SQL
  name_escaped=$(echo "$fname" | sed "s/'/''/g")
  SQL="$SQL INSERT OR IGNORE INTO designs (design_id, name, sort_order) VALUES ('$stem', '$name_escaped', (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM designs));"
done

# Execute all INSERTs in one batch
echo ""
echo "Inserting ${#FILES[@]} records into D1..."
echo "$SQL" | npx wrangler d1 execute "$DB" --remote --batch-size=50

echo ""
echo "✅ Done. ${#FILES[@]} designs seeded."
