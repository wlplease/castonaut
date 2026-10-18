#!/usr/bin/env bash
set -Eeuo pipefail

DATA_MOUNT="/mnt/disks/snapchain-data"

for attempt in $(seq 1 60); do
  mountpoint -q "$DATA_MOUNT" && break
  sleep 5
done
if ! mountpoint -q "$DATA_MOUNT"; then
  echo "Snapchain data disk is not mounted at $DATA_MOUNT" >&2
  exit 1
fi

# The startup script creates the mount as root. Let the SSH user create the
# bootstrap files; Snapchain's installer elevates itself when it configures Docker.
sudo chown "$(id -u):$(id -g)" "$DATA_MOUNT"
ln -sfn "$DATA_MOUNT" "$HOME/snapchain"
cd "$HOME/snapchain"
curl -fsSL https://raw.githubusercontent.com/farcasterxyz/snapchain/refs/heads/main/scripts/snapchain-bootstrap.sh | bash
