"use strict";
const express = require("express");
const c = require("./dashboard.controller");
const router = express.Router();
router.get("/", c.kpis);
router.get("/kpis", c.kpis);
module.exports = { basePath: "/dashboard", feature: null, router };
