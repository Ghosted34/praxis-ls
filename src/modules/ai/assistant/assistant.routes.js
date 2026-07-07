"use strict";
const express = require("express");
const c = require("./assistant.controller");
const { validate } = require("./assistant.validator");

const router = express.Router();
router.post("/ask", validate("ask"), c.ask);
router.post("/actions/:id/confirm", c.confirm);

module.exports = { basePath: "/ai", feature: "ai.assistant.backend", router };
