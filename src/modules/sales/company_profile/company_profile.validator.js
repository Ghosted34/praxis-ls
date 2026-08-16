"use strict"; const {z}=require("zod"); const {AppError}=require("../../../utils/errors");
const extractionFields=z.object({
 slogan:z.string().max(500).optional(), positioning:z.string().max(5000).optional(),
 operating_regions:z.array(z.string()).optional(), gateways:z.array(z.string()).optional(),
 memberships:z.array(z.string()).optional(), certifications:z.array(z.string()).optional(),
 service_promises:z.array(z.object({title:z.string(),value:z.string()})).optional(),
 projects:z.array(z.object({name_en:z.string().min(1),name_fr:z.string().optional(),description_en:z.string().optional(),description_fr:z.string().optional(),metrics:z.record(z.union([z.string(),z.number(),z.boolean()])).optional()})).optional(),
}).strict();
const project=z.object({name_en:z.string().min(1),name_fr:z.string().optional().nullable(),description_en:z.string().optional().nullable(),description_fr:z.string().optional().nullable(),metrics:z.record(z.union([z.string(),z.number(),z.boolean()])).optional(),sort_order:z.number().int().optional()});
const schema=z.object({slogan:z.string().max(500).optional().nullable(),positioning:z.string().max(5000).optional().nullable(),operating_regions:z.array(z.string()).optional(),gateways:z.array(z.string()).optional(),memberships:z.array(z.string()).optional(),certifications:z.array(z.string()).optional(),service_promises:z.array(z.object({title:z.string(),value:z.string()})).optional(),source_document_id:z.string().uuid().optional().nullable(),projects:z.array(project).optional()});
const extractSchema=z.object({document_id:z.string().uuid()});
const update=(req,_res,next)=>{const p=schema.safeParse(req.body);if(!p.success)return next(new AppError("VALIDATION_ERROR","Invalid company profile",422,p.error.flatten().fieldErrors));req.body=p.data;next();}; const extract=(req,_res,next)=>{const p=extractSchema.safeParse(req.body);if(!p.success)return next(new AppError("VALIDATION_ERROR","A vaulted company-profile document is required",422,p.error.flatten().fieldErrors));req.body=p.data;next();};
module.exports={schema,extractionFields,update,extract};
