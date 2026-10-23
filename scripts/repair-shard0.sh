#!/usr/bin/env bash
set -Eeuo pipefail

# Targeted recovery for the v0.14.3 missing shard-0 snapshot state.
# This keeps shard 1/2, the old shard-0 directory, and the old snapshot cache.

NODE=/mnt/disks/snapchain-data
BASE=https://pub-d352dd8819104a778e20d08888c5a661.r2.dev
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DL="$NODE/shard0-repair-$STAMP"

if [[ $EUID -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi
mountpoint -q "$NODE" || { echo "Data disk is not mounted; stopping."; exit 1; }
[[ -d "$NODE/.rocks/shard-0" && -d "$NODE/.rocks.snapshot" ]] || {
  echo "Expected shard or snapshot directory is missing; stopping."
  exit 1
}

free_gib=$(df -BG --output=avail "$NODE" | tail -n 1 | tr -dc '0-9')
if (( free_gib < 100 )); then
  echo "Need at least 100 GiB free; found about ${free_gib} GiB. Stopping."
  exit 1
fi

mkdir -p "$DL"
meta=$(curl -fsS "$BASE/FARCASTER_NETWORK_MAINNET/0/latest.json")
key=$(jq -er '.key_base' <<<"$meta")
[[ "$key" == FARCASTER_NETWORK_MAINNET/0/* ]] || {
  echo "Unexpected snapshot path; stopping."
  exit 1
}
jq -er '.chunks[]' <<<"$meta" > "$DL/chunks.txt"
if grep -Ev '^chunk_[0-9]+\.bin$' "$DL/chunks.txt"; then
  echo "Unexpected chunk name; stopping."
  exit 1
fi

count=$(wc -l < "$DL/chunks.txt")
if (( count == 0 )); then
  echo "Snapshot has no chunks; stopping."
  exit 1
fi
echo "Snapshot: $key ($count chunks); free space: ${free_gib} GiB"
df -h "$NODE"

if ! xargs -r -P 8 -I '{}' sh -c '
  if ! gzip -t "$1" 2>/dev/null; then
    curl -fsS --retry 5 --retry-delay 3 -o "$1" "$2" && gzip -t "$1"
  fi
' _ "$DL/{}" "$BASE/$key/{}" < "$DL/chunks.txt"; then
  echo "Download failed. Node data was not changed; download files remain in $DL"
  exit 1
fi

echo "All snapshot chunks verified."

read -r -p "Type REPAIR to stop Snapchain and restore shard 0 only: " answer
if [[ "$answer" != REPAIR ]]; then
  echo "Cancelled; node data was not changed. Download remains at $DL"
  exit 1
fi

OLD="$NODE/.rocks/shard-0.before-repair-$STAMP"
OLD_CACHE="$NODE/.rocks.snapshot.before-repair-$STAMP"
cd "$NODE"
docker stop --time 30 snapchain-snapchain-1
mv "$NODE/.rocks/shard-0" "$OLD"

if ! mv "$NODE/.rocks.snapshot" "$OLD_CACHE"; then
  mv "$OLD" "$NODE/.rocks/shard-0"
  docker start snapchain-snapchain-1
  echo "Could not preserve snapshot cache; original shard restored."
  exit 1
fi

if ! (while IFS= read -r chunk; do gunzip -c "$DL/$chunk"; done < "$DL/chunks.txt" | tar -x -C "$NODE/.rocks"); then
  echo "Extraction failed. Snapchain is stopped; backups are at:"
  echo "  $OLD"
  echo "  $OLD_CACHE"
  echo "Do not delete those backups."
  exit 1
fi

docker start snapchain-snapchain-1
echo "Shard 0 restored. Shards 1 and 2 were not modified."
echo "Backups and downloaded chunks are retained on the data disk."
echo "Repair ID: $STAMP"
