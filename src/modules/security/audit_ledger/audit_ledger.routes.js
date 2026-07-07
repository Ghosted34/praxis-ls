"use strict";
const express = require("express");
const c = require("./audit_ledger.controller");
const router = express.Router();
router.get("/", c.list);
router.get("/:id", c.get);
module.exports = { basePath: "/audit", feature: null, router };
