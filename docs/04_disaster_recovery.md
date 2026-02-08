# Disaster Recovery (v3.5.0)

## If integrity violation occurs
1. Open History → check Integrity badge.
2. Use Emergency Export (encrypted) to preserve data.
3. If needed, Wipe local cache and re-import from a known-good export.

## If cloud data is lost
1. Import your encrypted export bundle.
2. Login and re-sync to cloud (push encrypted blob).

## If a device is compromised
1. Settings → Devices → Revoke that device.
2. Change vault passphrase (re-encrypt).
3. Optional: Cloud wipe and re-seed from clean export.
