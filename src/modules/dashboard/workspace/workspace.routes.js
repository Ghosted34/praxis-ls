"use strict";
const express = require("express");
const c = require("./workspace.controller");
const router = express.Router();
router.get("/", c.mine);
module.exports = { basePath: "/workspace", feature: null, router };
