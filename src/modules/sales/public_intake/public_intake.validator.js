"use strict";const {z}=require("zod");const {AppError}=require("../../../utils/errors");const trap={website_url:z.string().max(0).optional(),form_started_at:z.number().int().optional()};const email=z.string().email().max(255);/**
 * WAREHOUSE_DURATION mirrors the CHECK constraint on quote_request
 * (0683_sales_crm_f6_lead_intake.sql). Listed rather than imported because a
 * public schema that drifts from the column is a 500 on INSERT instead of a
 * 422 naming the field — tests/unit/public-intake-quote-fields.test.js pins
 * the two together.
 */
const WAREHOUSE_DURATION=["LESS_THAN_7_DAYS","DAYS_7_TO_14","DAYS_15_TO_30","OVER_30_DAYS","UNKNOWN"];
/**
 * A place the requester picked from OUR picker, not a coordinate they typed.
 *
 * Only the provider's id and the text that produced it travel. There is
 * deliberately no latitude or longitude here: geo_place.confirmSuggestion
 * re-runs the search server-side and takes the coordinate from the provider's
 * own answer, because a body that could carry a coordinate could carry any
 * coordinate and have it stored as provider-vouched. That is a provenance
 * forgery, and provenance is the whole claim this feature makes.
 */
const placePick=z.object({provider_place_id:z.string().min(1).max(300),query:z.string().min(1).max(255),country:z.string().length(2).optional()}).strict();
const schemas={quote:z.object({...trap,requester_name:z.string().max(255).optional(),requester_company:z.string().max(255).optional(),requester_email:email.optional(),requester_phone:z.string().max(60).optional(),service_category:z.string().max(255).optional(),origin_location:z.string().max(255).optional(),destination_location:z.string().max(255).optional(),cargo_description:z.string().max(5000).optional(),incoterm:z.string().min(1).max(30),entity_id:z.string().uuid().optional(),estimated_weight:z.coerce.number().nonnegative().max(1e9).optional(),project_cargo_flag:z.boolean().optional(),warehouse_location:z.string().max(255).optional(),warehouse_duration:z.enum(WAREHOUSE_DURATION).optional(),additional_notes:z.string().max(5000).optional(),origin_place:placePick.optional(),destination_place:placePick.optional(),attachment_data_url:z.string().max(12_000_000).optional(),attachment_filename:z.string().max(200).optional()}).strict(),contact:z.object({...trap,name:z.string().max(255).optional(),email:email.optional(),phone:z.string().max(60).optional(),company_name:z.string().max(255).optional(),subject:z.string().max(255).optional(),message:z.string().min(1).max(20000),enquiry_type:z.enum(["GENERAL_ENQUIRY","PARTNERSHIP","CAREERS","MEDIA"]).optional()}).strict(),partnership:z.object({...trap,company_name:z.string().min(1).max(255),country_of_origin:z.string().max(255).optional(),website:z.string().max(255).optional(),contact_name:z.string().max(255).optional(),contact_title:z.string().max(255).optional(),email:email.optional(),contact_phone:z.string().max(60).optional(),proposal_type:z.enum(["AGENCY_PARTNERSHIP","VENDOR_REGISTRATION"]).optional(),network_memberships:z.array(z.string().max(60)).max(25).optional(),proposal_text:z.string().max(5000).optional()}).strict(),newsletter:z.object({...trap,email,name:z.string().max(255).optional()}).strict()};const mw=k=>(req,_res,next)=>{const p=schemas[k].safeParse(req.body);if(!p.success)return next(new AppError("VALIDATION_ERROR","Invalid submission",422,p.error.flatten().fieldErrors));if(p.data.form_started_at&&Date.now()-p.data.form_started_at<1500)return next(new AppError("SPAM_REJECTED","Submission rejected",422));delete p.data.website_url;delete p.data.form_started_at;req.body=p.data;next();};module.exports={schemas,quote:mw("quote"),contact:mw("contact"),partnership:mw("partnership"),newsletter:mw("newsletter")};
