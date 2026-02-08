# LifeOS Data Schema (v3.5.0)

## Vault (encrypted payload)
The encrypted vault contains:
- `state`: tasks, templates, settings, notifications, stats cache
- `history`: audit events (hash-chain)

## Task
Fields:
- id, title, notes, status(active/done/missed)
- priority(1..5), tags[], dueAt(ISO|null)
- subtasks[{id,title,done}]
- templateId|null
- createdAt, updatedAt

## History Event
- id, type, entity, entityId, payload(before/after)
- timestamp, deviceId, appVersion
- prevHash, hash

## Notes
- Analytics and XP are computed from history events.
- Integrity status gates analytics/XP/sync.
