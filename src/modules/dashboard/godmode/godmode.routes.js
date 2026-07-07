"use strict";
const express = require("express");
const c = require("./godmode.controller");
const router = express.Router();
router.get("/soft-deletes", c.list);
router.post("/purge", c.purge);
module.exports = { basePath: "/god-mode", feature: null, router };
