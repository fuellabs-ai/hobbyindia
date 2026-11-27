# Reviewed guides

Empty on purpose. No guide has passed human review yet.

A guide goes here only after two people have checked every step against the current official source. Name the file `<card-id>.json`. The card with that id then shows "Reviewed guide" instead of "Official route only".

```json
{
  "card_id": "cpgrams-closed",
  "applies_to": "...",
  "does_not_apply_to": "...",
  "steps": [{"text": "...", "source_url": "...", "source_passage": "..."}],
  "reviewed_by": ["name", "name"],
  "reviewed_on": "YYYY-MM-DD",
  "next_review": "YYYY-MM-DD"
}
```

The build refuses a guide that has fewer than two `reviewed_by` names, or a `next_review` date in the past. Fill `reviewed_by` by hand. Never generate it.
