"use strict";
const { z } = require("zod");
const { AppError } = require("../../../utils/errors");
const create = z.object({ ref: z.string().optional(), entity_id: z.string().uuid().optional(), client_id: z.string().uuid().optional(), service_type_id: z.string().uuid().optional(), status: z.enum(["OPEN","IN_PROGRESS","COMPLETED","CANCELLED"]).optional(), incoterm: z.string().optional(), bl_mawb: z.string().optional(), vessel_flight: z.string().optional(), pol: z.string().optional(), pod: z.string().optional(), customs_regime: z.string().optional(), eta: z.string().optional() });
const schemas = { create, update: create.partial() };
const mw = (k) => (req,_res,next) => { const p = schemas[k].safeParse(req.body); if(!p.success) return next(new AppError("VALIDATION_ERROR","Invalid body",422,p.error.flatten().fieldErrors)); req.body=p.data; return next(); };
module.exports = { create: mw("create"), update: mw("update"), schemas };
