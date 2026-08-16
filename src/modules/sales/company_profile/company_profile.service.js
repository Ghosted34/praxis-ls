"use strict";
const repo=require("./company_profile.repo"); const {audit}=require("../../../shared/events/emit");
const documents=require("../../vault/document_vault/document_vault.service");
const vision=require("../../../services/ai/vision.service");
const governance=require("../../ai/governance/governance.service");
const {extractionFields}=require("./company_profile.validator");
const {AppError}=require("../../../utils/errors");
const DECLARED=["slogan","positioning","operating_regions","gateways","memberships","certifications","service_promises","source_document_id"];
async function get(c){const p=await repo.get(c); if(!p)return null; return {...p,projects:await repo.projects(c,p.company_profile_id)};}
async function save(c,{data,actor={}}){await c.query("BEGIN");try{const before=await repo.get(c);const f=Object.fromEntries(DECLARED.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));f.declared_confirmed_at=new Date();f.declared_confirmed_by=actor.user_id||null;const row=await repo.update(c,f);if(data.projects)await repo.replaceProjects(c,row.company_profile_id,data.projects);await audit(c,{actorUserId:actor.user_id||null,action:"company_profile.updated",moduleKey:"MOD-23",entityRef:"company_profile:"+row.company_profile_id,before,after:row});await c.query("COMMIT");return get(c);}catch(e){await c.query("ROLLBACK");throw e;}}
async function refresh(c,{actor={}}={}){const d=await repo.derived(c);const row=await repo.update(c,{...d,computed_at:new Date()});await audit(c,{actorUserId:actor.user_id||null,action:"company_profile.refreshed",moduleKey:"MOD-23",entityRef:"company_profile:"+row.company_profile_id,after:{computed_at:row.computed_at}});return get(c);}
async function getFresh(c,{maxAgeHours=24}={}){const p=await get(c);if(!p.computed_at||Date.now()-new Date(p.computed_at).getTime()>maxAgeHours*3600000)return refresh(c);return p;}
async function extractDocument(c,{documentId,actor={},env="live"}){
 const {doc,buffer}=await documents.fetchBytes(c,documentId);
 if(!["application/pdf","image/png","image/jpeg","image/jpg","image/webp"].includes(doc.content_type||mimeFromPath(doc.storage_path))) throw new AppError("BAD_FILE_TYPE","Company profile extraction accepts PDF or images",422);
 // Sandbox extraction is deliberately a mock: no live credit can be spent by test data.
 if(env!=="live") return {suggestions:{},requires_confirmation:true,provider:"mock",sandbox:true};
 const gate=await governance.canUseFeature(c,{userId:actor.user_id,featureKey:"doc_vision"});
 if(!gate.allowed) throw new AppError("AI_UNAVAILABLE",gate.reason||"Document extraction is unavailable",403);
 const vendor=await governance.getVendorConfig(c,"gemini");
 const prompt="Extract only these company-profile facts when explicitly stated: slogan, positioning, operating_regions (array), gateways (array), memberships (array), certifications (array), service_promises ({title,value} array), projects ({name_en,name_fr,description_en,description_fr,metrics} array). Never infer or invent a value. Omit unknown fields";
 const started=Date.now();
 const result=await vision.extract({image:buffer,mimeType:doc.content_type||mimeFromPath(doc.storage_path),prompt,vendor});
 const parsed=extractionFields.safeParse(result.fields);
 await governance.recordUsage(c,{userId:actor.user_id||null,featureKey:"doc_vision",provider:result.provider,model:vendor&&vendor.model,callType:"company_profile_extraction",latencyMs:Date.now()-started,wasSuccessful:parsed.success,errorCode:parsed.success?null:"INVALID_EXTRACTION"});
 if(!parsed.success) throw new AppError("INVALID_EXTRACTION","The document did not produce a valid company profile. Enter the facts manually.",422,parsed.error.flatten().fieldErrors);
 return {suggestions:parsed.data,requires_confirmation:true,provider:result.provider,sandbox:false};
}
function mimeFromPath(value=""){const p=String(value).toLowerCase();if(p.endsWith(".pdf"))return "application/pdf";if(p.endsWith(".png"))return "image/png";if(p.endsWith(".webp"))return "image/webp";if(p.endsWith(".jpg")||p.endsWith(".jpeg"))return "image/jpeg";return null;}
module.exports={get,save,refresh,getFresh,extractDocument,mimeFromPath};
