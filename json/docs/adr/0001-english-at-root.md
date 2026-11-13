---
status: accepted
---

# English at the site root, Portuguese at /pt/

fix-json started in Portuguese and served pt-BR at `fix-json.dev/` (also as `x-default`). We decided to serve English at the root and move Portuguese to `/pt/`, with English also as the source page and the fallback for missing translations, because it is a developer tool with a global audience and a visitor whose language we don't match should land on English. The cost: already-indexed URLs change language, and Portuguese visitors who never picked a language now see the root in English (the language hint still offers Portuguese).
