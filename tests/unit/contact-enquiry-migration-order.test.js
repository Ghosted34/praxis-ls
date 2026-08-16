"use strict";
const fs=require("fs"),path=require("path"),crypto=require("crypto");
const root=path.join(__dirname,"../..");
const migration=fs.readFileSync(path.join(root,"migrations/tenant/0689_sales_crm_f9_contact_enquiries.sql"),"utf8");
const repair=fs.readFileSync(path.join(root,"migrations/tenant/0695_repair_f9_migration_hash.sql"),"utf8");
test("0689 removes the old status check before rewriting TRIAGED rows",()=>{
 const drop=migration.indexOf("DROP CONSTRAINT IF EXISTS contact_enquiry_status_check");
 const rewrite=migration.indexOf("UPDATE contact_enquiry SET status = 'READ'");
 const add=migration.indexOf("ADD CONSTRAINT ck_contact_enquiry_status");
 expect(drop).toBeGreaterThan(-1);expect(drop).toBeLessThan(rewrite);expect(rewrite).toBeLessThan(add);
});
test("the ledger repair acknowledges exactly the corrected 0689 bytes",()=>{
 const hash=crypto.createHash("sha256").update(Buffer.from(migration)).digest("hex");
 expect(repair).toContain(`SET sha256 = '${hash}'`);
 expect(repair).toContain("AND sha256 = 'e50193fb2e78b1f2261cf591dbabdbf6f4dd7f016a22935661195af56bd3a180'");
});
