# fix-json

A browser tool that reads JSON-like text, fixes what is broken, and shows the result formatted and validated.

## Language

**fix-json**:
The product (site and brand).
_Avoid_: Fix JSON (old name of Auto-fix), JSON Formatter

**Auto-fix**:
The option that lets fix-json change the input so it becomes valid JSON. When it is off, the input is read as strict JSON only.
_Avoid_: Fix JSON, Fix mode, lenient mode

**Fix**:
Any change Auto-fix makes to the input. Each kind below is a Fix.
_Avoid_: repair, correction

### Kinds of Fix

**Lenient reading**:
Accepting syntax outside strict JSON: single quotes, unquoted keys, comments and trailing commas.
_Avoid_: JSON5 (JSON5 is a spec, not this reading), loose parse

**Inserted comma**:
A comma that was missing between two items and was added.
_Avoid_: comma repair

**Join**:
Several separate values in a row in the input, turned into a single array.
_Avoid_: concatenation, wrap

**Unwrap**:
The whole input is a string whose content is JSON; it is replaced by that content.
_Avoid_: unstringify, Expansion (Expansion is something else)

**Expansion**:
A string value *inside* the input whose content is JSON, replaced by the object or array it holds.
_Avoid_: Unwrap (Unwrap is the whole input), deserialize

**Completion**:
A fragment missing its outer container (e.g. `"a": 1`) gets the braces or brackets that make it a whole value.
_Avoid_: complete fragment, wrap

**Closing**:
Brackets or braces that were opened and never closed get the closer they were missing.
_Avoid_: auto-close, closers

**Implicit object**:
A key whose value is another key with no `{ }` around it (e.g. `"a": "b": 1`) gets the braces that make that value an object.
_Avoid_: nested keys, wrapped key
