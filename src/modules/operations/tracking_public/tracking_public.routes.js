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
const express=require("express");const {makeLimiter}=require("../../../shared/http/rate-limit");const {asyncHandler}=require("../../../utils/errors");const s=require("./tracking_public.service");const router=express.Router(),limit=makeLimiter({name:"tracking-public",max:30,windowMs:15*60*1000});router.get("/:reference",limit,asyncHandler(async(req,res)=>res.json({data:await req.tenantDbIn("live",c=>s.get(c,req.params.reference))})));module.exports={basePath:"/public/tracking",feature:null,idParam:"text",router};
