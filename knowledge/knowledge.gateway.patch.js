'use strict';

/**
 * knowledge.gateway.patch.js
 *
 * API Gateway integration patch for the knowledge service.
 *
 * HOW TO APPLY
 * ─────────────
 * 1. Add this entry to api-gateway/config.js → services:
 *
 *    knowledge: {
 *      POST:      'knowledge/create',   // POST   /api/v1/knowledge
 *      GET:       'knowledge/list',     // GET    /api/v1/knowledge
 *      GET_ID:    'knowledge/get',      // GET    /api/v1/knowledge/:id
 *      PUT_ID:    'knowledge/update',   // PUT    /api/v1/knowledge/:id
 *      DELETE_ID: 'knowledge/delete',   // DELETE /api/v1/knowledge/:id
 *    },
 *
 * 2. Add the validation blocks from VALIDATION BLOCKS section below to
 *    api-gateway/src/routes/apiRouter.js before the final serviceMap.resolve() call.
 *
 * 3. Restart the API gateway.
 */

// ── Schema ──────────────────────────────────────────────────────────────────
//
// Service:  knowledge
// Table:    public.knowledge
// Fields:
//   id          uuid        PK
//   tenant_id   uuid        NOT NULL (RLS)
//   title       text        NOT NULL
//   content     text        NOT NULL
//   category    text        optional
//   status      text        NOT NULL  — draft | published | archived
//   created_at  timestamptz
//   updated_at  timestamptz

// ── SERVICE REGISTRY ENTRY (config.js) ──────────────────────────────────────
const SERVICE_REGISTRY_ENTRY = {
  knowledge: {
    POST:      'knowledge/create',
    GET:       'knowledge/list',
    GET_ID:    'knowledge/get',
    PUT_ID:    'knowledge/update',
    DELETE_ID: 'knowledge/delete',
  },
};

// ── VALIDATION BLOCKS (apiRouter.js) ────────────────────────────────────────
//
// Paste these two blocks into apiRouter.js before the serviceMap.resolve() call.

/*
  // ── knowledge — POST validation ──────────────────────────────────────────
  if (req.method === 'POST' && service === 'knowledge') {
    const { title, content, category, status } = req.body || {};
    req.body = {};
    if (title    !== undefined) req.body.title    = typeof title === 'string' ? title.trim() : title;
    if (content  !== undefined) req.body.content  = typeof content === 'string' ? content.trim() : content;
    if (category !== undefined) req.body.category = typeof category === 'string' ? category.trim() : category;
    if (status   !== undefined) req.body.status   = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (!req.body.title || req.body.title === '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
    }
    if (!req.body.content || req.body.content === '') {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'content is required' } });
    }
    const VALID_KNOWLEDGE_STATUSES = ['draft', 'published', 'archived'];
    if (req.body.status !== undefined && !VALID_KNOWLEDGE_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: draft, published, archived' } });
    }
  }

  // ── knowledge — PUT validation ────────────────────────────────────────────
  if (req.method === 'PUT' && service === 'knowledge') {
    const { title, content, category, status } = req.body || {};
    req.body = {};
    if (title    !== undefined) req.body.title    = typeof title === 'string' ? title.trim() : title;
    if (content  !== undefined) req.body.content  = typeof content === 'string' ? content.trim() : content;
    if (category !== undefined) req.body.category = typeof category === 'string' ? category.trim() : category;
    if (status   !== undefined) req.body.status   = typeof status === 'string' ? status.trim().toLowerCase() : status;

    if (Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'At least one of title, content, category, or status is required' } });
    }
    const VALID_KNOWLEDGE_STATUSES = ['draft', 'published', 'archived'];
    if (req.body.status !== undefined && !VALID_KNOWLEDGE_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'status must be one of: draft, published, archived' } });
    }
  }
*/

module.exports = { SERVICE_REGISTRY_ENTRY };
