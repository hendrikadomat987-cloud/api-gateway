# Real Vapi Payloads

Dieses Verzeichnis enthält **echte Webhook-Bodies** aus Vapi-Delivery-Logs.

Dateien hier haben **Vorrang** vor den Placeholder-Fixtures in `../` (eine Ebene höher).
Wenn eine Datei hier existiert, laden Shape- und Replay-Tests diese automatisch und
zeigen `[fixture-source] <name>: REAL` im Output.

---

## Wie echte Payloads ablegen

1. **Vapi Dashboard** → Logs → Webhook Delivery → Request Body kopieren
2. JSON in die passende Datei hier speichern (roher Webhook-Body, 1:1)
3. Optional: `_fixture_meta`-Block ergänzen (wird beim Laden automatisch entfernt)
4. Tests neu starten — werden automatisch erkannt

**Welche Datei für welchen Event-Typ:**

| Vapi `message.type`  | Dateiname                        |
|----------------------|----------------------------------|
| `status-update`      | `vapi-status-update.json`        |
| `end-of-call-report` | `vapi-end-of-call-report.json`   |
| `tool-calls`         | `vapi-tool-call.json`            |
| Unbekannter Typ      | `vapi-unknown-shape.json`        |

---

## Dateiformat

Roher Webhook-Body von Vapi — **keine Veränderungen notwendig**:

```json
{
  "message": {
    "type": "status-update",
    "status": "in-progress",
    "call": {
      "id": "call_abc123",
      "orgId": "org_xyz",
      ...
    }
  }
}
```

**Optionaler Meta-Block** (wird beim Laden ignoriert):

```json
{
  "_fixture_meta": {
    "captured_at": "2026-04-07",
    "call_id": "call_abc123",
    "notes": "Erster Live-Anruf Restaurant-Track"
  },
  "message": { ... }
}
```

---

## Verhalten der Tests

| Situation                       | Shape-Test             | Replay-Test            |
|---------------------------------|------------------------|------------------------|
| Real fixture vorhanden          | `REAL` im Output       | `REAL` im Output       |
| Kein real fixture               | `PLACEHOLDER` fallback | `PLACEHOLDER` fallback |
| Real fixture mit Platzhaltern   | Warnung ausgegeben     | Patch per patchCallId  |

- `.gitignore` enthält dieses Verzeichnis **nicht** — echte Payloads können committet werden
- Payloads enthalten keine Secrets — Call-IDs und Org-IDs sind Vapi-intern und nicht sicherheitskritisch
- Wenn Call-IDs oder AssistantIds aus Datenschutzgründen geschwärzt werden sollen: `patchCallId` / `patchAssistantId` im Test erledigen das zur Laufzeit

---

## Erkennbar in der Test-Ausgabe

```
console.info [fixture-source] vapi-status-update.json → REAL
console.info [fixture-source] vapi-end-of-call-report.json → PLACEHOLDER
```

Wenn `PLACEHOLDER` erscheint, obwohl du eine echte Datei erwartest: prüfe den Dateinamen.
