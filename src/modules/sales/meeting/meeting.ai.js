"use strict";
const service = require("./meeting.service");
const validator = require("./meeting.validator");
module.exports = {
  entity: "meeting", module_key: "MOD-21", screens: [],
  reads: [
    { key: "list_meetings", service: (c, p) => service.list(c, p), describe: "List meetings (filter lead/client)." },
    { key: "get_meeting", service: (c, p) => service.get(c, p.id || p), describe: "Get a meeting with its notes/minutes and discovery sections." },
    { key: "get_meeting_discovery", service: (c, p) => service.discovery(c, p.meeting_id || p.id || p), describe: "Get the three client-discovery sections of a meeting, with their probing questions." },
    // The read F4 (proposal generation) makes: the client's own words, most
    // recent first, without having to know which meeting they were said at.
    { key: "get_lead_discovery", service: (c, p) => service.latestDiscoveryFor(c, { leadId: p.lead_id }), schema: validator.schemas.aiDiscovery, describe: "Get the latest client-discovery set captured for a lead (by id)." },
  ],
  writes: [
    { key: "schedule_meeting", service: (c, p) => service.create(c, { data: p }), schema: validator.schemas.create, permission: { module: "MOD-21", action: "create" }, confirm: true, describe: "Schedule a meeting." },
    { key: "add_meeting_note", service: (c, p) => service.addNote(c, { meetingId: p.meeting_id, body: p.body, isMinutes: p.is_minutes }), schema: validator.schemas.aiNote, permission: { module: "MOD-21", action: "edit" }, confirm: true, describe: "Add a note or minutes to a meeting (by id)." },
    { key: "save_meeting_discovery_section", service: (c, p) => service.saveSection(c, { meetingId: p.meeting_id, sectionKey: p.section_key, body: p.body }), schema: validator.schemas.aiSection, permission: { module: "MOD-21", action: "edit" }, confirm: true, describe: "Write one discovery section (OPERATIONS / PAIN_POINTS / STRATEGY) of a meeting." },
  ],
};
