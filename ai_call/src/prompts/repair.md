{{request}}

## Your previous reply was invalid

Validation error:

<<<DATA {{nonce}} kind=error>>>
{{error}}
<<<END {{nonce}}>>>

Previous reply:

<<<DATA {{nonce}} kind=previous-reply>>>
{{previous}}
<<<END {{nonce}}>>>

Reply again with a single JSON object and nothing else, matching this JSON Schema:

```json
{{schema}}
```
