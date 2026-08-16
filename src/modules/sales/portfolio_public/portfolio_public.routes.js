"use strict";
/**
 * PUBLIC ROUTES ARE PINNED TO LIVE.
 *
 * These endpoints are reachable with no session, so the caller is an anonymous
 * visitor on the tenant's marketing site. `req.tenantDb` resolves the
 * environment from the `X-Praxis-Env` header, which means that visitor chose
 * it: sending `X-Praxis-Env: sandbox` made a website submission land in the
 * tenant's SANDBOX schema (verified) and made sandbox rows publicly readable.
 * The environment a request runs in is a signed-in user's choice, not the
 * internet's. `req.tenantDbIn("live", …)` is the same mechanism the careers
 * module uses for exactly this reason (src/middleware/tenant-context.js).
 */
const express=require("express");const {makeLimiter}=require("../../../shared/http/rate-limit");const {asyncHandler}=require("../../../utils/errors");const s=require("./portfolio_public.service");const router=express.Router(),limit=makeLimiter({name:"portfolio-public",max:120,windowMs:15*60*1000});router.get("/",limit,asyncHandler(async(req,res)=>res.json({data:await req.tenantDbIn("live",c=>s.list(c))})));router.get("/media/:id",limit,asyncHandler(async(req,res)=>{const {doc,buffer}=await req.tenantDbIn("live",c=>s.media(c,req.params.id));res.type(doc.storage_path.endsWith(".png")?"png":doc.storage_path.endsWith(".pdf")?"pdf":"jpeg").send(buffer);}));router.get("/:slug",limit,asyncHandler(async(req,res)=>res.json({data:await req.tenantDbIn("live",c=>s.get(c,req.params.slug))})));module.exports={basePath:"/public/portfolio",feature:null,idParam:"text",router};
