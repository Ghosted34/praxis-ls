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
const express=require("express");const {makeLimiter}=require("../../../shared/http/rate-limit");const {asyncHandler}=require("../../../utils/errors");const s=require("./public_intake.service"),v=require("./public_intake.validator");const router=express.Router();const limit=name=>makeLimiter({name:`public-${name}`,max:5,windowMs:60*60*1000});router.post("/quote-requests",limit("quote"),v.quote,asyncHandler(async(req,res)=>res.status(201).json({data:await req.tenantDbIn("live",c=>s.submitQuote(c,req.body))})));router.post("/contact-enquiries",limit("contact"),v.contact,asyncHandler(async(req,res)=>res.status(201).json({data:await req.tenantDbIn("live",c=>s.submitContact(c,req.body))})));router.post("/partnerships",limit("partnership"),v.partnership,asyncHandler(async(req,res)=>res.status(201).json({data:await req.tenantDbIn("live",c=>s.submitPartnership(c,req.body))})));router.post("/newsletter",limit("newsletter"),v.newsletter,asyncHandler(async(req,res)=>res.status(201).json({data:await req.tenantDbIn("live",c=>s.subscribe(c,req.body))})));module.exports={basePath:"/public/intake",feature:null,router};
