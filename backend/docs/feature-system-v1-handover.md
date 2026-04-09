# Feature System V1 — Handover

> Letzte Aktualisierung: V1-Abschluss (nach Review + Finalisierung)

## V1 ist abgeschlossen — Phase 2 kann beginnen

Alle identifizierten Bugs und Testlücken sind geschlossen. Offene Punkte sind
bewusst auf Phase 2 verschoben und hier dokumentiert.

---

## Fixes in der Abschlussrunde (V1-Finalisierung)

### Bug: Doppelter DB-Zugriff in `GET /api/v1/features`

`src/routes/features.ts` rief `getTenantFeatures` und `getTenantDomains` parallel
via `Promise.all` auf. Bei Cache-Miss feuerten beide Funktionen intern jeweils
`getTenantFeatureKeys + getTenantDomainKeys` → 4 DB-Queries statt 2.

Fix: sequenzielle Aufrufe. `getTenantFeatures` befüllt den Cache, `getTenantDomains`
trifft danach den Cache.

### Toter Code: `VoiceFeatureNotEnabledError` entfernt

Die Klasse war in `voice-errors.ts` definiert aber nie geworfen. Feature-Blocks
werden im Tool-Dispatch als per-Tool-Ergebnis zurückgegeben (`{ success: false, error: '...' }`),
nicht als HTTP-Fehler. Klasse entfernt.

### Irreführender Kommentar in `tool-feature-map.ts` korrigiert

Der Kommentar bei `answer_booking_question` suggerierte einen Map-Override der
nicht existiert. Der Special Case lebt in `getRequiredFeature()`. Kommentar neu
geschrieben.

### Domain-disable-Inkonsistenz dokumentiert

In `feature.repository.ts::getTenantFeatureKeys()` ist jetzt ein Kommentar, der
erklärt: Wenn `tenant_domains.is_enabled = false`, werden Features dieser Domain
trotzdem als aktiv ausgeliefert, solange `tenant_features.is_enabled = true`. Das
ist in Phase 1 kein Problem (kein Code-Pfad deaktiviert Domains), muss aber bei
Einführung einer Domain-Disable-Admin-Funktion in Phase 2 behoben werden.

### Neue Tests: Layer-2-Gating direkt + `is_enabled = false`

Neue Testdatei: `test-engine-v2/services/voice/voice-feature-gate-direct.test.js`
Neue Migration: `backend/migrations/20260410000001_test_feature_gate_tenant.sql`

Testtenante `44444444-…`:
- Booking-Track, voice-only Features
- `booking.availability` mit `is_enabled = false` in `tenant_features`

Tests:
- A: `check_availability` → Layer-2-Block (booking.availability disabled)
- B: `get_next_free` → Layer-2-Block (gleicher Feature-Key)
- C: `create_callback_request` → kein Feature-Block (voice.callback aktiv)
- D: `/api/v1/features` → booking.availability nicht im Response (requires TOKEN_FEATURE_GATE_TENANT)

---

## Was konsolidiert wurde (vorherige Runde)

Dieser Schritt konsolidiert das bestehende Feature System V1 ohne neue Architektur.
Keine neuen Tabellen, keine Breaking Changes, kein Umbau.

---

## 1. `updated_at` — gelöst via Trigger-Migration

**Migration:** `20260410000000_feature_system_v1_consolidation.sql`

Die initiale Migrations-Datei (20260401000000) enthielt seit Beginn den Hinweis:
> "Apply a shared `set_updated_at()` trigger function (e.g. moddatetime) to all tables that carry `updated_at`."

Das wurde jetzt umgesetzt. Die neue Migration:

- Definiert `set_updated_at()` als `CREATE OR REPLACE FUNCTION` (idempotent)
- Registriert `BEFORE UPDATE … FOR EACH ROW` Trigger auf **allen 18 Tabellen** mit `updated_at`:
  - voice_providers, voice_agents, voice_numbers, voice_calls, voice_sessions, voice_order_contexts
  - voice_callback_requests
  - restaurant_settings
  - salon_services, salon_stylists, salon_bookings, voice_salon_contexts, salon_settings
  - salon_stylist_working_hours
  - domains, features, tenant_domains, tenant_features

Die Trigger auf `tenant_domains` und `tenant_features` (FORCE RLS) sind sicher: Der Trigger
schreibt nur `NEW.updated_at`, liest keine Zeilen und unterliegt daher keiner RLS-Prüfung.

Trigger-Naming: `trg_{table_name}_updated_at` — konsistent, leicht greifbar via psql `\dg`.

---

## 2. Provisionierungslogik — zentral in `lib/provision-tenant-domains.js`

**Vorher:** Die SQL-Schleife für domain → feature provisioning war in beiden Seed-Skripten
identisch dupliziert (~25 Zeilen, zweimal).

**Jetzt:** Eine einzige Quelle in `backend/lib/provision-tenant-domains.js`.

Beide Seed-Skripte rufen jetzt auf:
```js
const { provisionTenantDomains } = require('./lib/provision-tenant-domains');
await provisionTenantDomains(client, TENANT_ID, ['voice', 'salon']);
```

Der Helper ist:
- **Idempotent** — `ON CONFLICT … DO NOTHING` auf beiden Tabellen
- **Resilient** — gibt ein `⚠`-Log aus wenn die Feature-System-Migration noch nicht gelaufen ist
- **Explizit** — caller gibt die Domain-Liste an, kein Versteckspiel

Das TypeScript-Äquivalent für Runtime-Provisioning ist `feature.repository.ts → provisionTenantDomain()`.
Beide folgen exakt demselben Algorithmus (Schritt 1-3 identisch).

---

## 3. Voice-Regel — explizit dokumentiert

**Regel:** Jeder voice-fähige Tenant benötigt `voice.core` und `voice.callback`.
Diese Features gehören zur `voice`-Domain in `domain_features`.

**Wo dokumentiert:**
- `lib/provision-tenant-domains.js` — Docstring mit Erklärung und Standardaufruf-Muster
- `feature.repository.ts → provisionTenantDomain()` — Kommentar mit Voice Rule + Aufruf-Muster

**Wo die Regel durchgesetzt wird:**
- Seed-Skripte: `['voice', 'salon']` — 'voice' immer explizit als erstes
- Migration DO-Block: provisioned 'voice' für alle 4 Test-Tenants
- Runtime: Kein Auto-Inject — caller (Seed oder Admin-Logik) ist verantwortlich

---

## 4. Tenant FK — bewusst nicht eingeführt

**Befund:** Kein `tenants`-Stammtisch im Schema. Alle 30+ Tabellen des Projekts
verwenden `tenant_id UUID` ohne FK-Constraint. Das ist eine bewusste Architekturentscheidung.

**Warum kein FK:**
- Tenant-Existenz wird über JWT-Claims geprüft, nicht über eine DB-Zeile
- Kein `tenants`-Table → FK-Ziel existiert nicht
- Alle anderen Tabellen (voice, salon, restaurant) arbeiten gleich
- Isolation erfolgt über FORCE RLS, nicht FK

**Entscheidung:** Kein FK auf `tenant_domains.tenant_id` oder `tenant_features.tenant_id`.
Dokumentiert im Header von `20260410000000_feature_system_v1_consolidation.sql`.

---

## 5. Drift-Bereinigung in Tests

Die Test-Datei `voice-feature-provisioning.test.js` referenzierte falsche Feature-Keys,
die nicht mit der Migration übereinstimmten:

| Alt (falsch)         | Korrekt (aus Migration)    |
|----------------------|----------------------------|
| `restaurant.orders`  | `restaurant.ordering`      |
| `restaurant.premium` | `restaurant.delivery`      |
| `salon.stylist`      | `salon.booking`            |
| `salon.faq`          | `salon.availability`       |
| `booking.premium`    | `booking.availability` (*)  |

(*) `booking.availability` fehlte komplett in der EXPECTED-Liste für Tenant A.

Alle 12 Feature-Keys im `ALL_KNOWN_FEATURE_KEYS`-Set wurden korrigiert.

---

## Aktueller Stand des Feature-Systems

### Tabellen
| Tabelle | RLS | updated_at Trigger |
|---|---|---|
| `domains` | Nein (globaler Katalog) | ✓ |
| `features` | Nein (globaler Katalog) | ✓ |
| `domain_features` | Nein (globaler Katalog) | — (kein updated_at) |
| `tenant_domains` | FORCE RLS | ✓ |
| `tenant_features` | FORCE RLS | ✓ |

### Feature-Katalog (12 Keys)
| Domain | Feature Key | Kategorie |
|---|---|---|
| voice | `voice.core` | core |
| voice | `voice.callback` | core |
| booking | `booking.core` | core |
| booking | `booking.availability` | core |
| booking | `booking.faq` | addon |
| restaurant | `restaurant.core` | core |
| restaurant | `restaurant.menu` | core |
| restaurant | `restaurant.ordering` | core |
| restaurant | `restaurant.delivery` | addon |
| salon | `salon.core` | core |
| salon | `salon.booking` | core |
| salon | `salon.availability` | addon |

### Provisioning-Pfade
| Kontext | Weg |
|---|---|
| Migration (Test-Tenants) | DO-Block in 20260409000000 |
| Seed-Skripte | `lib/provision-tenant-domains.js` |
| Runtime/Admin | `feature.repository.ts → provisionTenantDomain()` |
| Service-Cache | `feature.service.ts` — 60s TTL, invalidierbar via `invalidateTenantFeatureCache()` |

---

## Dateien geändert / erstellt (Konsolidierungsrunde)

| Datei | Art |
|---|---|
| `migrations/20260410000000_feature_system_v1_consolidation.sql` | Neu (Trigger + FK-Doku) |
| `lib/provision-tenant-domains.js` | Neu (zentrale Provisioning-Logik für Seeds) |
| `seed-salon-tenant.js` | Geändert (nutzt Helper, -25 Zeilen) |
| `seed-salon-tenant-2.js` | Geändert (nutzt Helper, -25 Zeilen) |
| `src/modules/features/repositories/feature.repository.ts` | Kommentar ergänzt (Voice Rule) |
| `test-engine-v2/services/voice/voice-feature-provisioning.test.js` | Feature-Keys korrigiert |

## Dateien geändert / erstellt (V1-Abschlussrunde)

| Datei | Art |
|---|---|
| `src/routes/features.ts` | Bug-Fix: sequenzielle Aufrufe statt Promise.all |
| `src/errors/voice-errors.ts` | Toten Code entfernt (VoiceFeatureNotEnabledError) |
| `src/modules/voice/orchestration/tool-feature-map.ts` | Kommentar korrigiert |
| `src/modules/features/repositories/feature.repository.ts` | Domain-disable-Inkonsistenz dokumentiert |
| `migrations/20260410000001_test_feature_gate_tenant.sql` | Neu (Feature Gate Test Tenant) |
| `test-engine-v2/core/factories.js` | VAPI_FEATURE_GATE_ASSISTANT_ID ergänzt |
| `test-engine-v2/config/config.js` | tenantFeatureGate (optional) ergänzt |
| `test-engine-v2/services/voice/voice-feature-gate-direct.test.js` | Neu (Layer-2 + is_enabled Tests) |

---

## Bewusst auf Phase 2 verschoben

| Thema | Begründung |
|---|---|
| Domain-Disable-Funktion | Kein Code-Pfad setzt heute `tenant_domains.is_enabled = false`; Inkonsistenz hat keine Auswirkung in V1 |
| Structured Logging bei Feature-Block | Observability-Verbesserung, kein Bug; sinnvoll wenn Feature-System produktiv genutzt wird |
| `/api/v1/features` mit Feature-Metadaten | Name, Kategorie, Source: nötig für Admin-UI, nicht für V1-Runtime |
| Salon-Callback-Tool | Separate Entscheidung ob create_callback_request in SALON_TOOLS kommt |
| Trigger auf alle restlichen Tabellen | Updated_at-Trigger decken alle Tabellen mit updated_at bereits ab (20260410000000) |
