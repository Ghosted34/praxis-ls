"use strict";
const fs=require("fs"),path=require("path");
const validator=require("../../src/modules/sales/company_profile/company_profile.validator");
const repoSource=fs.readFileSync(path.join(__dirname,"../../src/modules/sales/company_profile/company_profile.repo.js"),"utf8");
const migration=fs.readFileSync(path.join(__dirname,"../../migrations/tenant/0691_sales_crm_f2_company_profile.sql"),"utf8");
describe("F2 company profile",()=>{
 test("declared facts are structured and bilingual projects validate",()=>{expect(validator.schema.parse({slogan:"Beyond",memberships:["WCA"],projects:[{name_en:"Port move",name_fr:"Transport portuaire",metrics:{teu:250}}]}).projects[0].metrics.teu).toBe(250);});
 test("derived SQL never selects commercially sensitive fields",()=>{expect(repoSource).not.toMatch(/\b(cost|margin|profit|unit_price|purchase_price)\b/i);expect(repoSource).toContain("SELECT count(*)::int FROM vehicle");expect(migration).toContain("computed_at");});
 test("consent is three-state and defaults anonymised-by-policy",()=>{expect(migration).toContain("NOT_ASKED");expect(migration).toContain("ANONYMISED_ONLY");expect(migration).toContain("NAMED");expect(migration).toContain("DEFAULT 'NOT_ASKED'");});
 test("migration and nightly registration are rerunnable",()=>{expect(migration).not.toMatch(/CREATE TABLE (?!IF NOT EXISTS)/i);const workers=fs.readFileSync(path.join(__dirname,"../../src/jobs/workers.js"),"utf8");expect(workers).toContain('company-profile-refresh-scheduler');expect(workers).toContain('15 2 * * *');});
});
