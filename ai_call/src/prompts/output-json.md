Reply with a single JSON object and nothing else, matching this JSON Schema:

```json
{{schema}}
```

Put every edit in `edits`, setting `violationId` to the id of the violation it fixes (for example `v1`). Put every violation you do not fix in `skipped` with a reason.
