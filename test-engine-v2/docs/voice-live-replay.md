# Voice Live-Replay Tests

## Zweck

Die Live-Replay-Tests schließen die Lücke zwischen den synthetischen Factory-Tests und
echten Vapi-Webhook-Payloads. Sie dienen dem frühen Erkennen von Kompatibilitätsproblemen,
die nur mit echten Payloads sichtbar werden — z. B. Felder, die die Factory weglässt,
aber ein echtes Vapi-Event mitschickt, oder Typunterschiede (JSON-String vs. Objekt).

**Diese Tests ersetzen keine bestehenden Factory-Tests.** Sie sind eine zusätzliche Schicht
für Live-Debugging.

---

## Dateistruktur

```
test-engine-v2/
├── fixtures/
│   └── voice/
│       └── live/
│           ├── vapi-status-update.json       ← Placeholder-Fixture (Fallback)
│           ├── vapi-end-of-call-report.json  ← Placeholder-Fixture (Fallback)
│           ├── vapi-tool-call.json           ← Placeholder-Fixture (Fallback)
│           ├── vapi-unknown-shape.json       ← Fixture für unbekannten Event-Typ
│           └── real/                         ← Echte Vapi-Payloads (bevorzugt)
│               ├── README.md                 ← Anleitung
│               ├── vapi-status-update.json   ← (optional) echter Payload
│               ├── vapi-end-of-call-report.json ← (optional)
│               └── vapi-tool-call.json       ← (optional)
├── core/
│   ├── fixtureLoader.js                      ← Helper: Fixtures laden und patchen
│   └── payloadDiff.js                        ← Strukturvergleich real vs. placeholder
└── services/voice/
    ├── voice-live-webhook-shape.test.js       ← Struktur-Validierung + Diff-Analyse
    └── voice-live-payload-replay.test.js      ← HTTP-Replay gegen den Webhook-Endpoint
```

---

## Wo echte Vapi-Payloads ablegen

Echte Payloads gehören in `fixtures/voice/live/real/` — **nicht** die bestehenden
Placeholder-Dateien überschreiben.

1. Vapi Dashboard → Logs → Webhook Delivery → Raw Body kopieren
2. JSON in `fixtures/voice/live/real/<name>.json` ablegen (gleicher Dateiname wie Placeholder)
3. `_fixture_meta`-Block kann ergänzt werden (wird beim Laden automatisch entfernt)
4. Tests starten — die Datei wird automatisch bevorzugt

**Welche Datei für welchen Event-Typ:**

| Vapi `message.type`  | Datei in `real/`                 |
|----------------------|----------------------------------|
| `status-update`      | `vapi-status-update.json`        |
| `end-of-call-report` | `vapi-end-of-call-report.json`   |
| `tool-calls`         | `vapi-tool-call.json`            |
| Unbekannter Typ      | `vapi-unknown-shape.json`        |

### Dateiformat

Roher Webhook-Body 1:1 aus Vapi — keine Anpassungen notwendig:

```json
{
  "message": {
    "type": "status-update",
    "status": "in-progress",
    "call": { "id": "call_abc123", "orgId": "org_xyz", ... }
  }
}
```

Call-ID und AssistantId werden zur Testlaufzeit per `patchCallId` / `patchAssistantId`
überschrieben — sie müssen im Payload nicht manuell angepasst werden.

---

## Wie Placeholder und Real-Fixtures zusammenspielen

Der `fixtureLoader` sucht immer zuerst in `real/`, dann im Placeholder-Verzeichnis:

```
loadFixtureWithFallback('vapi-status-update.json')
  → sucht: fixtures/voice/live/real/vapi-status-update.json  (bevorzugt)
  → fallback: fixtures/voice/live/vapi-status-update.json    (Placeholder)
  → gibt zurück: { fixture: {...}, source: 'real'|'placeholder' }
```

- Placeholder-Fixtures bleiben unverändert
- Kein Umbenennen oder Löschen von Dateien nötig
- Neue real-Fixtures können schrittweise ergänzt werden

---

## Woran erkenne ich, ob real oder placeholder verwendet wurde

**In der Test-Ausgabe** (console.info):

```
console.info [fixture-source] vapi-status-update.json → REAL
console.info [fixture-source] vapi-end-of-call-report.json → PLACEHOLDER
```

**Im Directory-Test:**

```
console.info [fixture-source] Real Vapi payloads available (2):
  ✓ real/vapi-status-update.json
  ✓ real/vapi-tool-call.json
```

Wenn `PLACEHOLDER` erscheint, obwohl eine echte Datei erwartet wird: Dateinamen prüfen.

---

## Neue Fixture für neuen Event-Typ hinzufügen

1. Placeholder: `fixtures/voice/live/vapi-<type>.json` (Dokumentation)
2. Real: `fixtures/voice/live/real/vapi-<type>.json` (echter Payload)
3. Shape-Test in `voice-live-webhook-shape.test.js` ergänzen
4. Optional: Replay-Test-Case in `voice-live-payload-replay.test.js` ergänzen

---

## Bekannte Factory ↔ Live Payload-Unterschiede

Die Shape-Tests dokumentieren und prüfen diese Abweichungen explizit:

| Feld                         | Factory          | Real Vapi Payload         |
|------------------------------|------------------|---------------------------|
| `call.orgId`                 | fehlt            | immer vorhanden           |
| `call.type`                  | fehlt            | z. B. `inboundPhoneCall`  |
| `call.phoneNumberId`         | fehlt            | bei Inbound-Calls gesetzt |
| `call.customer.number`       | fehlt            | Anrufernummer             |
| `durationMinutes`            | fehlt (nur `durationSeconds`) | vorhanden  |
| `transcript`                 | fehlt            | vollständiges Transkript  |
| `cost` / `costBreakdown`     | fehlt            | Kosten-Aufschlüsselung    |
| `analysis`                   | fehlt            | Struktur-Evaluation       |
| `messages`                   | fehlt            | Pro-Turn Transkript-Array |
| `toolWithToolCallList`       | fehlt            | parallel zu `toolCallList`|
| `function.arguments` als String | immer Objekt | kann JSON-String sein    |

---

## Diff-Analyse: real vs. placeholder

Wenn ein REAL-Fixture geladen wird, berechnet der Shape-Test automatisch einen strukturellen
Vergleich gegen das Placeholder-Pendant und gibt ihn als `[fixture-diff]` aus:

```
console.info [fixture-diff] vapi-status-update.json
  onlyInReal        (2): ["message.call.startTime","message.call.endTime"]
  onlyInPlaceholder (0): []
  typeMismatches    (1): ["message.toolCallList[0].function.arguments (real: string | placeholder: object)"]
```

**Was der Diff zeigt:**
- `onlyInReal` — Felder, die nur im echten Payload existieren (kein Placeholder-Äquivalent)
- `onlyInPlaceholder` — Felder, die der Placeholder hat, aber die echte Payload weglässt
- `typeMismatches` — Felder in beiden, aber mit unterschiedlichem JS-Typ

**Was der Diff NICHT zeigt:**
- Wert-Unterschiede bei gleichem Typ (z. B. unterschiedliche Call-IDs)
- Felder tiefer als 3 Rekursions-Ebenen (werden als Leaf behandelt)
- Array-Elemente (Arrays werden als `array[N]` verglichen)

Der Diff ist reines Logging — er bricht keine Tests.

---

## Fixture-API im fixtureLoader

```js
const {
  loadFixture,             // Lädt Placeholder aus fixtures/voice/live/
  loadFixtureWithFallback, // Bevorzugt real/, fallback auf Placeholder
  patchCallId,             // Setzt message.call.id
  patchAssistantId,        // Setzt message.call.assistantId
  realFixtureExists,       // true wenn real/<name> vorhanden
  listRealFixtures,        // Array der real/-Dateinamen
  FIXTURE_BASE,            // Pfad zu fixtures/voice/live/
  REAL_FIXTURE_BASE,       // Pfad zu fixtures/voice/live/real/
} = require('../../core/fixtureLoader');

// Fixture bevorzugt aus real/ laden:
const { fixture, source } = loadFixtureWithFallback('vapi-status-update.json');
console.info(`Source: ${source}`); // 'real' oder 'placeholder'

patchCallId(fixture, uniqueVoiceCallId('my-test'));
patchAssistantId(fixture, process.env.VAPI_ASSISTANT_ID);

const res = await sendVoiceWebhook(fixture);
```

---

## Tests lokal ausführen

```bash
# Nur Shape-Validierung (kein HTTP, schnell)
npm run test:voice:live-shape

# Nur Replay-Tests (HTTP gegen Backend, benötigt .env)
npm run test:voice:live-replay

# Beides zusammen
npm run test:voice:live

# Mit Summary-Output
npm run test:summary:voice:live
```

### Voraussetzungen für Replay-Tests

Die `.env`-Datei muss folgende Variablen enthalten:

```
API_BASE_URL=http://localhost:3000/api/v1
TOKEN_TENANT_A=<JWT>
VAPI_WEBHOOK_SECRET=<secret>
VAPI_ASSISTANT_ID=<assistantId>          # optional, für Tenant-Routing
VAPI_RESTAURANT_ASSISTANT_ID=<id>        # optional, für Restaurant-Track
```

Wenn `VAPI_ASSISTANT_ID` nicht gesetzt ist, können Replay-Tests den Call nicht einem
Tenant zuordnen. Die Tests geben dann Warnungen aus, schlagen aber nicht hart fehl.

---

## Testverhalten bei Platzhalter-Fixtures

Solange noch keine echten Payloads eingefügt wurden, laufen die Tests mit den
Platzhalter-Fixtures:

- **Shape-Tests** laufen vollständig durch (prüfen Struktur der Platzhalter)
- **Replay-Tests** senden die Platzhalter-Fixtures an den Endpoint
  - Ergebnis hängt davon ab, ob der Backend-Router `REPLACE_WITH_*`-IDs toleriert
  - Persistenz-Assertions werden übersprungen (`console.warn`), nie hart geworfen

---

## Verhältnis zu bestehenden Factory-Tests

```
Factory-Tests       → testen das Verhalten mit synthetischen, kontrollierten Payloads
Live-Replay-Tests   → testen die Kompatibilität mit echten/realistischen Vapi-Payloads
```

Beide Schichten laufen unabhängig. `npm run test:voice` führt NUR die Factory-Tests aus.
`npm run test:voice:live` führt NUR die Live-Tests aus.
