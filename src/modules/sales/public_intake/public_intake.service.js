"use strict";

const lead = require("../lead/lead.service");
const quote = require("../quote_request/quote_request.service");
const enquiry = require("../inbound_intake/inbound_intake.service");
const partnership = require("../partnership_request/partnership_request.service");
const campaign = require("../marketing_campaign/marketing_campaign.service");
const { atomically } = require("../../../shared/db/tx");

const receipt = (row) => ({
  received: true,
  reference: row.public_ref || row.quote_request_id || row.contact_enquiry_id
    || row.partnership_request_id || row.email,
});

/** A website quote is one funnel intake: lead + linked quote or nothing. */
async function submitQuote(client, data) {
  const entityId = await quote.resolveEntityId(client, { data });
  return atomically(client, async () => {
    const createdLead = await lead.create(client, {
      data: {
        entity_id: entityId,
        company_name: data.requester_company || data.requester_name
          || data.requester_email || "Website quote request",
        contact_name: data.requester_name || null,
        email: data.requester_email || null,
        phone: data.requester_phone || null,
        source: "WEBSITE",
        intake_channel: "WEBSITE",
        service_interest: data.service_category || null,
        details: {
          origin_location: data.origin_location || null,
          destination_location: data.destination_location || null,
          cargo_description: data.cargo_description || null,
          incoterm: data.incoterm,
        },
      },
      actor: {},
    });
    const request = await quote.create(client, {
      data: {
        ...data,
        entity_id: entityId,
        lead_id: createdLead.lead_id,
        intake_channel: "WEBSITE",
      },
      actor: {},
    });
    return receipt(request);
  });
}

async function submitContact(client, data) {
  const row = await enquiry.submitEnquiry(client, {
    data: { ...data, source: "WEBSITE" },
    actor: {},
  });
  return receipt(row);
}

async function submitPartnership(client, data) {
  const row = await partnership.create(client, {
    data: { ...data, intake_channel: "WEBSITE" },
    actor: {},
  });
  return receipt(row);
}

async function subscribe(client, data) {
  const row = await campaign.subscribe(client, {
    email: data.email,
    name: data.name,
    source: "website",
    actor: {},
  });
  return receipt(row);
}

module.exports = { submitQuote, submitContact, submitPartnership, subscribe, receipt };
