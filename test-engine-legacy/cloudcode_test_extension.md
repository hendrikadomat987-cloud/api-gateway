# CloudCode Prompt – Test Engine Erweiterung

## Projektpfad (WICHTIG)
Arbeite innerhalb dieses Projekts:

C:\Users\hendre\claude-ai-voice-agent\test-engine

Relevante Struktur:
- core/apiClient.js
- core/testRunner.js
- tests/customer/customer.crud.test.js
- run-tests.js
- config.js

---

## Kontext

Wir haben eine funktionierende Node.js Test Engine für ein API Gateway + n8n System.

Die Engine nutzt:
- Axios (apiClient)
- Test Runner Pattern
- CRUD Tests
- JWT Multi-Tenant Authentication

Pattern:
Arrange → Act → Assert → Cleanup

---

## Ziel

Erweitere die bestehende Test-Suite, sodass ALLE bereits manuell getesteten Szenarien vollständig automatisiert abgedeckt sind.

WICHTIG:
- KEIN Refactoring
- KEINE bestehenden Tests löschen
- Nur ERWEITERN

---

## Zu implementierende Tests

### 1. DELETE Edge Cases
- DELETE ohne ID → MISSING_ID / 400
- DELETE invalid UUID → INVALID_ID
- DELETE bereits gelöschter Datensatz → NOT_FOUND

---

### 2. GET Edge Cases
- GET invalid ID → INVALID_ID
- GET nicht existierende ID → leer oder 404

---

### 3. CREATE Edge Cases
- Sonderzeichen (ÖÄÜ ß 🔥)
- Duplicate Inserts
- UTF-8 Encoding

---

### 4. Gateway Validierung
- PUT ohne ID → Fehler
- DELETE ohne ID → Fehler
- UUID Validierung
- Query vs Param Manipulation verhindern

---

### 5. Security Tests

#### Tenant Injection
- tenant_id im Body manipulieren
- muss vom Gateway überschrieben werden

#### Body Manipulation
- zusätzliche Felder einschleusen
- dürfen nicht übernommen werden

#### Cross Tenant (erweitert)
- Zugriff mit falschem JWT
- KEIN Daten-Leak erlaubt

---

## Technische Umsetzung

- Datei erweitern:
  tests/customer/customer.crud.test.js

- Nutze:
  - apiClient.js
  - testRunner.js
  - assertions.js
  - ctx für State

- Struktur:
  Neue Tests logisch gruppieren (Edge Cases, Security, Validation)

---

## Definition of Done

- Alle oben genannten Tests implementiert
- Alle bestehenden Tests funktionieren weiterhin
- Test-Suite deckt 100% der bekannten Szenarien ab
- Keine Sicherheitslücken mehr ungetestet

---

## Hinweis

Dies ist eine gezielte Erweiterung der Testabdeckung – keine Architekturänderung.
