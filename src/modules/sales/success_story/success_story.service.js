"use strict";

const repo = require("./success_story.repo");
const events = require("./success_story.events");
const validator = require("./success_story.validator");
const { emitEvent, audit, resolveActorId } = require("../../../shared/events/emit");
const { atomically } = require("../../../shared/db/tx");
const { AppError } = require("../../../utils/errors");
const { parseDataUrl } = require("../../../utils/data-url");
const llm = require("../../../services/ai/llm.service");
const storage = require("../../../services/storage.service");
const governance = require("../../ai/governance/governance.service");
const vault = require("../../vault/document_vault/document_vault.service");

const ref = (id) => `success_story:${id}`;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const writable = [
  "title", "slug", "client_id", "service_category", "headline",
  "executive_summary", "operations_execution", "kpis",
];
const pick = (data) => Object.fromEntries(
  writable.filter((key) => data[key] !== undefined).map((key) => [key, data[key]]),
);
const slug = (value) => String(value).toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function validateDossiers(client, dossierIds) {
  const ids = [...new Set((dossierIds || []).map(String))];
  if (!ids.length) {
    throw new AppError("DOSSIERS_REQUIRED", "Select at least one completed operations file", 422,
      { dossier_ids: ["at least one eligible dossier is required"] });
  }
  if (ids.length !== dossierIds.length) {
    throw new AppError("DUPLICATE_DOSSIER", "Each operations file may be selected only once", 422,
      { dossier_ids: ["duplicate dossier ids are not allowed"] });
  }
  const rows = await repo.eligibleByIds(client, ids);
  if (rows.length !== ids.length) {
    throw new AppError(
      "INELIGIBLE_DOSSIER",
      "Every selected operations file must exist and be completed, financially pending or closed",
      422,
      { dossier_ids: ["contains a missing or ineligible dossier"] },
    );
  }
  return rows;
}

async function currentEligibleDossiers(client, id) {
  const rows = await repo.dossiers(client, id);
  await validateDossiers(client, rows.map((row) => row.dossier_id));
  return rows;
}

async function create(client, { data, actor = {} }) {
  await validateDossiers(client, data.dossier_ids || []);
  return atomically(client, async () => {
    const fields = pick(data);
    const row = await repo.insert(client, {
      ...fields,
      slug: data.slug || slug(data.title),
      summary: data.executive_summary || null,
      body: data.operations_execution || null,
      ai_generated: false,
      is_published: false,
    });
    await repo.replaceDossiers(client, row.success_story_id, data.dossier_ids);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.CREATED,
      moduleKey: events.MODULE,
      entityRef: ref(row.success_story_id),
      after: row,
    });
    return get(client, row.success_story_id);
  });
}

async function update(client, { id, patch = {}, actor = {} }) {
  const before = await repo.get(client, id);
  if (!before) throw new AppError("NOT_FOUND", "Success story not found", 404);
  if (before.is_published) throw new AppError("LOCKED", "Unpublish before editing", 422);
  const current = await repo.dossiers(client, id);
  const dossierIds = patch.dossier_ids || current.map((row) => row.dossier_id);
  await validateDossiers(client, dossierIds);

  return atomically(client, async () => {
    const fields = pick(patch);
    const materialEdit = Object.keys(fields).length > 0 || patch.dossier_ids !== undefined;
    if (patch.executive_summary !== undefined) fields.summary = patch.executive_summary;
    if (patch.operations_execution !== undefined) fields.body = patch.operations_execution;
    if (materialEdit) fields.signed_off_by = null;
    const row = Object.keys(fields).length ? await repo.update(client, id, fields) : before;
    if (patch.dossier_ids !== undefined) await repo.replaceDossiers(client, id, dossierIds);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "success_story.updated",
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before,
      after: row,
    });
    return get(client, id);
  });
}

async function generate(client, { dossierIds, roughNotes = "", actor = {}, env = "live" }) {
  const chosen = await validateDossiers(client, dossierIds || []);
  if (env !== "live") {
    return { manual_required: true, prefill: { rough_notes: roughNotes, dossiers: chosen }, sandbox: true };
  }
  const gate = await governance.canUseFeature(client, {
    userId: actor.user_id,
    featureKey: "success_story_generation",
  });
  if (!gate.allowed) throw new AppError("AI_UNAVAILABLE", gate.reason, 403);
  const prompt = `Draft a public logistics case study from ONLY these operational fields (no financial fields were selected): ${JSON.stringify(chosen)}. Notes:${roughNotes}. Return JSON {headline,executive_summary,operations_execution,kpis:[{label,value}]} with 3 or 4 hard KPIs. Never invent a metric.`;
  const out = await llm.chat({
    client,
    messages: [{ role: "user", content: prompt }],
    responseFormat: { type: "json_object" },
  });
  let candidate;
  try {
    candidate = JSON.parse(String(out.text).replace(/^```json\s*|\s*```$/g, ""));
  } catch {
    return { manual_required: true, prefill: { rough_notes: roughNotes, dossiers: chosen }, sandbox: false };
  }
  const parsed = validator.generatedDraft.safeParse(candidate);
  if (!parsed.success) {
    return { manual_required: true, prefill: { rough_notes: roughNotes, dossiers: chosen }, sandbox: false };
  }
  await governance.recordUsage(client, {
    userId: actor.user_id || null,
    featureKey: "success_story_generation",
    provider: out.provider,
    callType: "success_story_generation",
    inputTokens: out.usage?.prompt_tokens || 0,
    outputTokens: out.usage?.completion_tokens || 0,
  });
  return { manual_required: false, draft: parsed.data, dossier_ids: dossierIds };
}

async function signOff(client, { id, actor = {} }) {
  const story = await repo.get(client, id);
  if (!story) throw new AppError("NOT_FOUND", "Success story not found", 404);
  if (story.is_published) throw new AppError("LOCKED", "The published story is already locked", 422);
  await currentEligibleDossiers(client, id);
  return atomically(client, async () => {
    const row = await repo.update(client, id, {
      signed_off_by: await resolveActorId(client, actor.user_id),
    });
    await emitEvent(client, {
      eventTypeKey: events.SIGNED_OFF,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.SIGNED_OFF,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: story,
      after: row,
    });
    return row;
  });
}

async function assertMediaBindings(client, story) {
  const checks = [];
  if (story.cover_vault_id) checks.push([story.cover_vault_id, "COVER"]);
  if (story.client_logo_vault_id) checks.push([story.client_logo_vault_id, "CLIENT_LOGO"]);
  for (const id of story.gallery_vault_ids || []) checks.push([id, "GALLERY"]);
  for (const [id, role] of checks) {
    // eslint-disable-next-line no-await-in-loop
    const { rows } = await client.query(
      `SELECT 1 FROM document_vault
        WHERE doc_id = $1 AND status = 'VERIFIED'
          AND doc_type = 'SUCCESS_STORY_MEDIA'
          AND public_media_scope = 'SUCCESS_STORY'
          AND public_media_entity_ref = $2
          AND public_media_role = $3
          AND public_media_content_type = ANY($4::text[])`,
      [id, ref(story.success_story_id), role, IMAGE_TYPES],
    );
    if (!rows.length) {
      throw new AppError("INVALID_PUBLIC_MEDIA", "All story media must be governed story image uploads", 422);
    }
  }
}

async function publish(client, { id, actor = {} }) {
  const story = await repo.get(client, id);
  if (!story) throw new AppError("NOT_FOUND", "Success story not found", 404);
  if (!story.signed_off_by) {
    throw new AppError("NOT_SIGNED_OFF", "A success story must be signed off before publishing", 422);
  }
  await currentEligibleDossiers(client, id);
  await assertMediaBindings(client, story);
  return atomically(client, async () => {
    const row = await repo.update(client, id, { is_published: true, published_at: new Date() });
    await emitEvent(client, {
      eventTypeKey: events.PUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.PUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: story,
      after: row,
    });
    return row;
  });
}

async function unpublish(client, { id, actor = {} }) {
  const story = await repo.get(client, id);
  if (!story) throw new AppError("NOT_FOUND", "Success story not found", 404);
  return atomically(client, async () => {
    const row = await repo.update(client, id, { is_published: false });
    await emitEvent(client, {
      eventTypeKey: events.UNPUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      actorUserId: actor.user_id || null,
    });
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: events.UNPUBLISHED,
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: story,
      after: row,
    });
    return row;
  });
}

/** Upload, classify and bind an image in one governed workflow. */
async function uploadMedia(client, { id, role, dataUrl, originalName = null, actor = {}, slug: tenantSlug }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !IMAGE_TYPES.includes(parsed.mimeType)) {
    throw new AppError("BAD_FILE_TYPE", "Story media must be PNG, JPEG or WebP", 422);
  }
  let created = null;
  try {
    return await atomically(client, async () => {
      const locked = await client.query("SELECT * FROM success_story WHERE success_story_id = $1 FOR UPDATE", [id]);
      const story = locked.rows[0];
      if (!story) throw new AppError("NOT_FOUND", "Success story not found", 404);
      if (story.is_published) throw new AppError("LOCKED", "Unpublish before changing story media", 422);
      created = await vault.createDocument(client, {
        entityRef: ref(id),
        docType: "SUCCESS_STORY_MEDIA",
        dataUrl,
        originalName,
        maxBytes: 10 * 1024 * 1024,
        allowedTypes: IMAGE_TYPES,
        sniff: true,
        slug: tenantSlug,
        actor,
      });
      await client.query(
        `UPDATE document_vault
            SET public_media_scope = 'SUCCESS_STORY', public_media_entity_ref = $2,
                public_media_role = $3, public_media_content_type = $4
          WHERE doc_id = $1`,
        [created.doc_id, ref(id), role, parsed.mimeType],
      );

      const fields = { signed_off_by: null };
      let replacedId = null;
      if (role === "COVER") {
        replacedId = story.cover_vault_id;
        fields.cover_vault_id = created.doc_id;
      } else if (role === "CLIENT_LOGO") {
        replacedId = story.client_logo_vault_id;
        fields.client_logo_vault_id = created.doc_id;
      } else {
        fields.gallery_vault_ids = [...new Set([...(story.gallery_vault_ids || []), created.doc_id])];
      }
      const updated = await repo.update(client, id, fields);
      if (replacedId && replacedId !== created.doc_id) {
        await client.query(
          `UPDATE document_vault
              SET status = 'ARCHIVED', public_media_scope = NULL,
                  public_media_entity_ref = NULL, public_media_role = NULL,
                  public_media_content_type = NULL
            WHERE doc_id = $1 AND public_media_scope = 'SUCCESS_STORY'
              AND public_media_entity_ref = $2`,
          [replacedId, ref(id)],
        );
      }
      await audit(client, {
        actorUserId: actor.user_id || null,
        action: "success_story.media_uploaded",
        moduleKey: events.MODULE,
        entityRef: ref(id),
        before: story,
        after: updated,
      });
      return { document: created, story: await get(client, id) };
    });
  } catch (error) {
    if (created?.storage_path) {
      try { await storage.delete(created.storage_path); } catch (_) { 
        /* @silent:storage|parse|teardown */
        /* best-effort object cleanup */ }
    }
    throw error;
  }
}

async function removeMedia(client, { id, documentId, actor = {} }) {
  return atomically(client, async () => {
    const locked = await client.query("SELECT * FROM success_story WHERE success_story_id = $1 FOR UPDATE", [id]);
    const story = locked.rows[0];
    if (!story) throw new AppError("NOT_FOUND", "Success story not found", 404);
    if (story.is_published) throw new AppError("LOCKED", "Unpublish before changing story media", 422);
    const bound = await client.query(
      `SELECT public_media_role FROM document_vault
        WHERE doc_id = $1 AND public_media_scope = 'SUCCESS_STORY'
          AND public_media_entity_ref = $2 FOR UPDATE`,
      [documentId, ref(id)],
    );
    const role = bound.rows[0]?.public_media_role;
    if (!role) throw new AppError("NOT_FOUND", "Story media not found", 404);
    const fields = { signed_off_by: null };
    if (role === "COVER" && story.cover_vault_id === documentId) fields.cover_vault_id = null;
    if (role === "CLIENT_LOGO" && story.client_logo_vault_id === documentId) fields.client_logo_vault_id = null;
    if (role === "GALLERY") fields.gallery_vault_ids = (story.gallery_vault_ids || []).filter((value) => value !== documentId);
    await client.query(
      `UPDATE document_vault
          SET status = 'ARCHIVED', public_media_scope = NULL,
              public_media_entity_ref = NULL, public_media_role = NULL,
              public_media_content_type = NULL
        WHERE doc_id = $1`,
      [documentId],
    );
    const updated = await repo.update(client, id, fields);
    await audit(client, {
      actorUserId: actor.user_id || null,
      action: "success_story.media_removed",
      moduleKey: events.MODULE,
      entityRef: ref(id),
      before: story,
      after: updated,
    });
    return get(client, id);
  });
}

async function get(client, id) {
  const row = await repo.get(client, id);
  if (row) row.dossiers = await repo.dossiers(client, id);
  return row;
}

const list = (client, query) => repo.list(client, query);
const eligible = (client, query) => repo.eligible(client, query);

module.exports = {
  create,
  update,
  generate,
  signOff,
  publish,
  unpublish,
  uploadMedia,
  removeMedia,
  assertMediaBindings,
  validateDossiers,
  get,
  list,
  eligible,
  slug,
};
