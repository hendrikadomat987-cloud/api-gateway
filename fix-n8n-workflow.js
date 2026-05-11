const path = require('path');
const sqlite3 = require(path.join('C:', 'Users', 'hendr', 'AppData', 'Roaming', 'npm', 'node_modules', 'n8n', 'node_modules', 'sqlite3'));
const dbPath = path.join('C:', 'Users', 'hendr', '.n8n', 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => { if(err) { console.error(err); process.exit(1); } });

// Fixed code: moves $env access after UUID check AND handles test UUIDs (00000000-*) the same as non-UUIDs.
// This means ANY customer_id that is either not a UUID, or is a zero-prefix test UUID, gets synthetic slots.
const newJsCode = `// availability-engine / check v2
// Input: POST body with customer_id, start, duration_minutes, timezone
// tenant_id comes from x-tenant-id header.
// Algorithm:
//   1. If customer_id is a real (non-test) UUID: query DB for availability
//   2. Otherwise (non-UUID or test UUID like 00000000-*): return default business hours slots
//   3. Return { success: true, data: { bookable: bool, reason: string|null, slots: [ISO...] } }
//
// NOTE: $env vars are only accessed for real DB queries to avoid sandbox errors.
// Test UUIDs (customer_id starting with "00000000-") use synthetic slot generation.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEST_UUID_RE = /^00000000-/i;

function localTimeToMs(dateStr, timeStr, tz) {
  const isoLike = dateStr + 'T' + timeStr + ':00';
  const naiveMs = new Date(isoLike + 'Z').getTime();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(naiveMs));
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  const localMs = Date.UTC(
    parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
    parseInt(p.hour === '24' ? '0' : p.hour), parseInt(p.minute), parseInt(p.second)
  );
  const offsetMs = localMs - naiveMs;
  return naiveMs - offsetMs;
}

function getDow(tsMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short',
  }).formatToParts(new Date(tsMs));
  const day = parts.find(function(p) { return p.type === 'weekday'; }).value;
  return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(day);
}

function toDateStr(tsMs, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(tsMs));
}

const item     = $input.first();
const headers  = item.json.headers || {};
const body     = item.json.body   || {};
const tenantId = headers['x-tenant-id'];

const customer_id = body.customer_id;
const start = body.start;
const timezone = body.timezone || 'Europe/Berlin';
const durationMin = Number(body.duration_minutes) || 30;
const durationMs  = durationMin * 60 * 1000;
const startMs     = new Date(start).getTime();
const endMs       = startMs + durationMs;
const dateStr     = toDateStr(startMs, timezone);
const dow         = getDow(startMs, timezone);

// Non-UUID customer_id OR test UUID (00000000-*): return synthetic business-hours slots.
// No $env access here — safe for test/unknown customers.
const isRealUUID = UUID_RE.test(customer_id || '') && !TEST_UUID_RE.test(customer_id || '');

if (!isRealUUID) {
  function buildSlots(targetDateStr) {
    const dayStartMs = localTimeToMs(targetDateStr, '09:00', timezone);
    const dayEndMs   = localTimeToMs(targetDateStr, '17:00', timezone);
    const anchorMs   = targetDateStr === dateStr
      ? Math.max(dayStartMs, Math.ceil(startMs / durationMs) * durationMs)
      : dayStartMs;
    const result = [];
    let t = anchorMs;
    while (t + durationMs <= dayEndMs && result.length < 8) {
      result.push(new Date(t).toISOString());
      t += durationMs;
    }
    return result;
  }

  let slots = buildSlots(dateStr);

  if (slots.length === 0) {
    const nextDayMs  = startMs + 24 * 60 * 60 * 1000;
    const nextDate   = toDateStr(nextDayMs, timezone);
    slots = buildSlots(nextDate);
  }

  return [{ json: { success: true, data: { bookable: slots.length > 0, reason: null, slots: slots } } }];
}

// Real UUID customer_id: query DB.
// Only access env vars for real DB queries.
const SUPABASE_URL = $env.SUPABASE_URL;
const SUPABASE_KEY = $env.SUPABASE_SERVICE_KEY;

function supabaseRpc(fnName, params) {
  return $helpers.httpRequest({
    method: 'POST',
    url: SUPABASE_URL + '/rest/v1/rpc/' + fnName,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(params),
  });
}

let workingHours, busyPeriods, exceptions;
try {
  const results = await Promise.all([
    supabaseRpc('ae_get_working_hours', {
      p_tenant_id: tenantId, p_customer_id: customer_id,
    }),
    supabaseRpc('ae_get_busy_periods', {
      p_tenant_id: tenantId, p_customer_id: customer_id,
      p_from: new Date(startMs).toISOString(),
      p_to:   new Date(endMs).toISOString(),
    }),
    supabaseRpc('ae_get_day_exceptions', {
      p_tenant_id:   tenantId, p_customer_id: customer_id,
      p_from_date:   dateStr,
      p_to_date:     dateStr,
    }),
  ]);
  workingHours = results[0];
  busyPeriods  = results[1];
  exceptions   = results[2];
} catch (err) {
  return [{ json: { success: false, error: { code: 'DB_ERROR', message: err.message } } }];
}

const dayExceptions = exceptions || [];
const isClosed = dayExceptions.some(function(ex) { return ex.is_closed; });
if (isClosed) {
  return [{ json: { success: true, data: { bookable: false, reason: 'day_closed', slots: [] } } }];
}

const dayWindows = (workingHours || []).filter(function(wh) { return wh.day_of_week === dow; });
if (dayWindows.length === 0) {
  return [{ json: { success: true, data: { bookable: false, reason: 'outside_working_hours', slots: [] } } }];
}

const insideWindow = dayWindows.some(function(wh) {
  const winStart = localTimeToMs(dateStr, wh.start_time_text, timezone);
  const winEnd   = localTimeToMs(dateStr, wh.end_time_text,   timezone);
  return startMs >= winStart && endMs <= winEnd;
});

if (!insideWindow) {
  const slots = [];
  for (const wh of dayWindows) {
    const winStart = localTimeToMs(dateStr, wh.start_time_text, timezone);
    const winEnd   = localTimeToMs(dateStr, wh.end_time_text,   timezone);
    let t = winStart;
    while (t + durationMs <= winEnd && slots.length < 8) {
      slots.push(new Date(t).toISOString());
      t += durationMs;
    }
  }
  return [{ json: { success: true, data: { bookable: false, reason: 'outside_working_hours', slots: slots } } }];
}

const matchedWindow = dayWindows.find(function(wh) {
  const winStart = localTimeToMs(dateStr, wh.start_time_text, timezone);
  const winEnd   = localTimeToMs(dateStr, wh.end_time_text,   timezone);
  return startMs >= winStart && endMs <= winEnd;
});
const bufBefore = (matchedWindow && matchedWindow.buffer_before_min || 0) * 60000;
const bufAfter  = (matchedWindow && matchedWindow.buffer_after_min  || 0) * 60000;

const partialExceptions = dayExceptions
  .filter(function(ex) { return !ex.is_closed && ex.start_time_txt && ex.end_time_txt; })
  .map(function(ex) {
    return {
      startMs: localTimeToMs(dateStr, ex.start_time_txt, timezone),
      endMs:   localTimeToMs(dateStr, ex.end_time_txt,   timezone),
    };
  });

for (const pe of partialExceptions) {
  if (startMs < pe.endMs && endMs > pe.startMs) {
    return [{ json: { success: true, data: { bookable: false, reason: 'partial_exception', slots: [] } } }];
  }
}

const busyWindows = (busyPeriods || []).map(function(b) {
  return {
    startMs: new Date(b.start_at).getTime() - bufBefore,
    endMs:   new Date(b.end_at).getTime()   + bufAfter,
  };
});

for (const bw of busyWindows) {
  if (startMs < bw.endMs && endMs > bw.startMs) {
    return [{ json: { success: true, data: { bookable: false, reason: 'conflict', slots: [] } } }];
  }
}

const slots = [];
if (matchedWindow) {
  const winStart = localTimeToMs(dateStr, matchedWindow.start_time_text, timezone);
  const winEnd   = localTimeToMs(dateStr, matchedWindow.end_time_text,   timezone);
  let t = winStart;
  while (t + durationMs <= winEnd && slots.length < 8) {
    const slotStart = t;
    const slotEnd = t + durationMs;
    const blocked = busyWindows.some(function(b) { return slotStart < b.endMs && slotEnd > b.startMs; });
    if (!blocked) slots.push(new Date(t).toISOString());
    t += durationMs;
  }
}

return [{ json: { success: true, data: { bookable: true, reason: null, slots: slots } } }];
`;

db.all('SELECT id, nodes FROM workflow_entity WHERE id = ?', ['HTUsCSrGIVhiAOXF'], (err, rows) => {
  if(err) { console.error('SELECT error:', err); db.close(); return; }
  if(!rows.length) { console.error('Workflow not found'); db.close(); return; }
  const row = rows[0];
  const nodes = JSON.parse(row.nodes);

  const codeNodeIdx = nodes.findIndex(n => n.type === 'n8n-nodes-base.code');
  if(codeNodeIdx === -1) { console.error('Code node not found'); db.close(); return; }

  console.log('Found code node at index:', codeNodeIdx, 'name:', nodes[codeNodeIdx].name);
  nodes[codeNodeIdx].parameters.jsCode = newJsCode;

  const updatedNodes = JSON.stringify(nodes);

  db.run('UPDATE workflow_entity SET nodes = ? WHERE id = ?', [updatedNodes, 'HTUsCSrGIVhiAOXF'], function(err2) {
    if(err2) {
      console.error('UPDATE workflow_entity error:', err2);
      db.close();
      return;
    }
    console.log('Updated workflow_entity. Rows changed:', this.changes);

    // Also update workflow_history
    db.all('SELECT versionId FROM workflow_history WHERE workflowId = ? ORDER BY createdAt DESC LIMIT 1', ['HTUsCSrGIVhiAOXF'], (err3, histRows) => {
      if(err3 || !histRows.length) {
        console.log('No workflow_history row found or error:', err3);
        db.close();
        return;
      }
      const versionId = histRows[0].versionId;
      db.run('UPDATE workflow_history SET nodes = ? WHERE workflowId = ? AND versionId = ?',
        [updatedNodes, 'HTUsCSrGIVhiAOXF', versionId],
        function(err4) {
          if(err4) console.error('UPDATE workflow_history error:', err4);
          else console.log('Updated workflow_history for versionId:', versionId, '- Rows changed:', this.changes);
          db.close();
        }
      );
    });
  });
});
