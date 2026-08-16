"use strict";
const crypto=require("crypto");const repo=require("../proposal/proposal.repo");const vault=require("../../vault/document_vault/document_vault.service");const {AppError}=require("../../../utils/errors");
const hash=t=>crypto.createHash("sha256").update(String(t)).digest("hex");
const notFound=()=>new AppError("NOT_FOUND","Proposal not found",404);
async function resolve(c,token){const p=await repo.byShareHash(c,hash(token));if(!p||p.status!=="SENT"||p.share_revoked_at||!p.share_expires_at||new Date(p.share_expires_at)<=new Date())throw notFound();return p;}
async function get(c,token){const p=await resolve(c,token);const [lines,narratives,client]=await Promise.all([repo.listLines(c,p.proposal_id),repo.listNarratives(c,p.proposal_id),p.client_id?c.query("SELECT name, legal_name FROM client_master WHERE client_id=$1",[p.client_id]):Promise.resolve({rows:[]})]);await repo.stampViewed(c,p.proposal_id);return {proposal:p,client:client.rows[0]||null,lines:lines.map(x=>({label:x.label,qty:x.qty,unit_price:x.unit_price})),narratives:narratives.map(x=>({section:x.section,language:x.language,body:x.body,sort_order:x.sort_order}))};}
async function download(c,token){const p=await resolve(c,token);if(!p.pdf_vault_id)throw notFound();const out=await vault.fetchBytes(c,p.pdf_vault_id);await repo.stampDownloaded(c,p.proposal_id);return out;}
module.exports={get,download,resolve,hash,notFound};
