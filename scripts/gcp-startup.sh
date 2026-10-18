#!/bin/bash
set -Eeuo pipefail

DATA_DEVICE="/dev/disk/by-id/google-castonaut-snapchain-data"
DATA_MOUNT="/mnt/disks/snapchain-data"

for attempt in $(seq 1 60); do
  [[ -e "$DATA_DEVICE" ]] && break
  sleep 5
done
if [[ ! -e "$DATA_DEVICE" ]]; then
  echo "Snapchain data disk did not appear at $DATA_DEVICE" >&2
  exit 1
fi

if ! blkid "$DATA_DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -F "$DATA_DEVICE"
fi
mkdir -p "$DATA_MOUNT"
if ! mountpoint -q "$DATA_MOUNT"; then
  mount -t ext4 "$DATA_DEVICE" "$DATA_MOUNT"
fi
DATA_UUID="$(blkid -s UUID -o value "$DATA_DEVICE")"
grep -q "UUID=$DATA_UUID" /etc/fstab || echo "UUID=$DATA_UUID $DATA_MOUNT ext4 defaults,nofail 0 2" >> /etc/fstab
chown root:root "$DATA_MOUNT"
chmod 0755 "$DATA_MOUNT"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl docker.io docker-compose-v2 jq
systemctl enable --now docker
echo "Castonaut node startup complete. Run the node command from the field guide to install Snapchain."
