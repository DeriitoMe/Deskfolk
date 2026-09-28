---
name: pet-notify
description: Notify the local Wakaba Mutsumi desktop pet of verified milestones. Questions use the native Codex interface.
---
# Desktop pet notifications
Use Codex's native question/input tool for every user question. The pet only reminds the user and opens Codex. Never ask or poll for answers through the pet; pet_ask, pet_wait_answer and pet_resolve_question have been retired.
Native question hooks create the reminder automatically. Do not duplicate them with pet_notify. For a verified completed milestone, pet_notify may send a brief factual stage_complete or task_complete notification. A stopped turn alone is not proof that a project is complete.
Permissions and approvals remain in Codex. PermissionRequest may be automatically reviewed and is not evidence of a user prompt; do not emit generic approval reminders from it.
