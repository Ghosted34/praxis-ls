"use strict";
const repo=require("./company_profile.repo"); const {audit}=require("../../../shared/events/emit");
const DECLARED=["slogan","positioning","operating_regions","gateways","memberships","certifications","service_promises","source_document_id"];
async function get(c){const p=await repo.get(c); if(!p)return null; return {...p,projects:await repo.projects(c,p.company_profile_id)};}
async function save(c,{data,actor={}}){await c.query("BEGIN");try{const before=await repo.get(c);const f=Object.fromEntries(DECLARED.filter(k=>data[k]!==undefined).map(k=>[k,data[k]]));f.declared_confirmed_at=new Date();f.declared_confirmed_by=actor.user_id||null;const row=await repo.update(c,f);if(data.projects)await repo.replaceProjects(c,row.company_profile_id,data.projects);await audit(c,{actorUserId:actor.user_id||null,action:"company_profile.updated",moduleKey:"MOD-23",entityRef:"company_profile:"+row.company_profile_id,before,after:row});await c.query("COMMIT");return get(c);}catch(e){await c.query("ROLLBACK");throw e;}}
async function refresh(c,{actor={}}={}){const d=await repo.derived(c);const row=await repo.update(c,{...d,computed_at:new Date()});await audit(c,{actorUserId:actor.user_id||null,action:"company_profile.refreshed",moduleKey:"MOD-23",entityRef:"company_profile:"+row.company_profile_id,after:{computed_at:row.computed_at}});return get(c);}
async function getFresh(c,{maxAgeHours=24}={}){const p=await get(c);if(!p.computed_at||Date.now()-new Date(p.computed_at).getTime()>maxAgeHours*3600000)return refresh(c);return p;}
module.exports={get,save,refresh,getFresh};
