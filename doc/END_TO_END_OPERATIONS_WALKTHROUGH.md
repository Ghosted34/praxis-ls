# End-to-End Operations Walkthrough

## Purpose

This walkthrough is the recording script for one continuous business scenario. It proves that Praxis LS can carry the same operation from people and access setup through commercial documents, execution, payroll, and accounting.

Use a clean demo or test tenant. Do **not** use real client, supplier, employee, banking, or payroll data in the recording.

---

## Scenario data

Use consistent, clearly fictional data throughout the recording.

| Item | Suggested demo value |
|---|---|
| Corporate entity | Arena Logistics Cameroon |
| Client | Demo Client SA |
| Supplier | Demo Transport SARL |
| Operations file | `DEMO-OPS-001` |
| Service | Import clearance and local delivery |
| Currency | XAF |
| Advance invoice | 50% of the quotation total |

Record the generated reference number and status after every major save. From the operations-file step onward, use the **same file** for every downstream document.

---

## Before recording

1. Provision or select a clean demo/test tenant.
2. Confirm the recording account has the required administration, HR, payroll, operations, commercial, finance, and accounting rights.
3. Confirm the relevant feature flags and master data are enabled for the tenant.
4. Start screen recording before the first create action.
5. Keep a short written log of generated references so they can be shown again in the accounting section.

---

## 1. Create employees

Go to **People → Employees**.

1. Open the employee list.
2. Select **Create employee**.
3. Create at least the following employees:
   - an HR/Payroll employee;
   - an Operations employee;
   - a Finance employee;
   - one regular employee who will receive a payslip.
4. Complete the required identity, employment, department, job-title, start-date, and payroll fields.
5. Save each employee.
6. Open each saved profile briefly to show it exists and is active.

**Show on screen:** employee reference, department, job title, and employment status.

---

## 2. Attribute roles

Go to **Security → Users and Roles**.

For each appropriate employee:

1. Create or connect the employee's user account, if required.
2. Open the employee's role/access area.
3. Assign only the rights needed for the scenario:
   - HR/Payroll employee: employee management and payroll rights;
   - Operations employee: operations-file rights;
   - Finance employee: costing, invoicing, cash request, and accounting rights.
4. Save the assignment.
5. Show the resulting role list or permission summary.

**Show on screen:** that access is intentional; do not make every user an administrator merely for the demo.

---

## 3. Create a corporate entity

Go to **Settings → Corporate Entities**.

1. Select **Create corporate entity**.
2. Enter the legal name, country, registration/tax details, address, currency, and invoice information.
3. Set the entity active or default if the workflow requires it.
4. Save.
5. Reopen the entity and show its reference and status.

This is the entity that owns the operation, invoices, payroll, and accounting postings.

---

## 4. Create the client

Go to **Master Data → Clients**.

1. Select **Create client**.
2. Enter the client name, contacts, billing address, tax information, payment terms, preferred language, and credit limit where relevant.
3. Save.
4. Open the client record and show that it is active and has the expected payment terms.

---

## 5. Create the supplier

Go to **Master Data → Suppliers**.

1. Select **Create supplier**.
2. Enter supplier identity/contact information, payment information, tax/registration information, and supplier type.
3. Save.
4. Complete supplier verification or activation if it is part of the tenant workflow.
5. Reopen the supplier record.

**Show on screen:** the supplier is active and usable before it is selected in costing or a cash request.

---

## 6. Create the operations file

Go to **Operations → Operations Files**.

1. Select **Create operations file**.
2. Choose the corporate entity and `Demo Client SA`.
3. Enter the service type, shipment/operation details, expected dates, and currency.
4. Save.
5. Record the generated file reference, for example `DEMO-OPS-001`.
6. Open the file overview.

**Show on screen:** the corporate entity, client, status, service details, and operations-file reference.

> From here onward, every commercial, execution, and accounting item should point to this same operations file.

---

## 7. Create costing for the file

Go to the operations file's costing area, or **Costing → Costing**.

1. Create a costing linked to `DEMO-OPS-001`.
2. Add revenue assumptions and operational/supplier cost lines.
3. Use `Demo Transport SARL` for a supplier cost where appropriate.
4. Confirm taxes, currencies, exchange rates, totals, and margin.
5. Save or submit according to the workflow.
6. Show the costing total, total costs, expected margin, and status.

**Show on screen:** the operations-file link and cost breakdown.

---

## 8. Create a quotation

Go to **Sales → Quotations**, or use the **Create quotation** action from the costing or operations file.

1. Create a quotation linked to:
   - `Demo Client SA`;
   - `DEMO-OPS-001`;
   - the costing created in the previous section.
2. Verify commercial lines, tax, total, validity period, and payment terms.
3. Save the quotation.
4. Generate or preview the quotation PDF if available.
5. Move the quotation through its required approval/send lifecycle.

**Show on screen:** quotation number, amount, client, and operations-file reference.

---

## 9. Create the advance-payment invoice

From the accepted quotation or operations file:

1. Select **Create advance invoice** or **Deposit invoice**.
2. Enter the agreed advance, such as 50% of the quotation total.
3. Verify its links to the quotation, client, and `DEMO-OPS-001`.
4. Save/post it through the required approval workflow.
5. Generate the invoice PDF.
6. If payment recording is part of the demo, record the advance payment and show the updated balance/status.

**Show on screen:** advance invoice number, amount, posted status, and balance.

---

## 10. Create the final invoice

1. Open the same operations file or quotation.
2. Select **Create final invoice**.
3. Verify the total operation value, advance deduction, remaining amount due, tax, and payment terms.
4. Save/post the final invoice.
5. Generate or preview the final-invoice PDF.
6. Record payment if it is included in the scenario, or leave it outstanding to demonstrate receivables.

**Show on screen:** the final invoice correctly recognizes the advance; the customer must not be billed for the full amount twice.

---

## 11. Create a cash request for the same file

Go to **Costing → Cash Requests**.

1. Select **Create cash request**.
2. Link it to `DEMO-OPS-001`.
3. Add a valid operational disbursement, such as customs, port, transport, or handling costs.
4. Select the requester and corporate entity.
5. Save.
6. Move it through the configured approval workflow.
7. Show the request status and operations-file link.

**Show on screen:** cash-request number, total, approval state, and the same operations-file reference.

---

## 12. Create the delivery note

Go to the operations file's document/delivery area, or **Operations → Delivery Notes**.

1. Create a delivery note linked to `DEMO-OPS-001`.
2. Select the client and enter delivery details.
3. Add the delivered service/goods lines as required.
4. Save.
5. Generate or preview the delivery-note PDF.
6. Demonstrate digital signing or proof of delivery if enabled.
7. Show the delivery-note reference and final status.

---

## 13. Generate payslips

Go to **People → Payroll → Payroll Runs**.

1. Create a payroll run for a defined pay period.
2. Include the employees created at the beginning of the walkthrough.
3. Confirm salary, allowances, deductions, and applicable statutory contributions/taxes.
4. Compute the payroll run.
5. Review the employee-level and total results.
6. Submit, approve, validate, and disburse according to the tenant's configured payroll lifecycle.
7. Generate a payslip for at least one employee.
8. Open or download the payslip PDF.

**Show on screen:** payroll-run status, net pay, and the generated payslip.

---

## 14. Demonstrate accounting traceability

Go to **Finance → General Ledger**.

For the same corporate entity and, where available, `DEMO-OPS-001`:

1. Open the accounting/journal-entry view.
2. Show postings created by:
   - the advance invoice;
   - the final invoice;
   - the client payment, if one was recorded;
   - the cash request/disbursement, if posted;
   - the payroll run.
3. Open at least one journal entry for each category.
4. Confirm each displayed journal is balanced and shows its source document, corporate entity, and posting date.
5. Show the source operations-file reference where the screen supports it.
6. Open the client receivable/account statement and show the advance/final-invoice position.
7. If available, return to `DEMO-OPS-001` and show actual revenue/costs against the original costing or margin view.

---

## Completion checklist

Before ending the recording, confirm that the video has visibly demonstrated:

- [ ] Employees created.
- [ ] Roles assigned.
- [ ] Corporate entity created.
- [ ] Client created.
- [ ] Supplier created and active.
- [ ] One operations file used consistently.
- [ ] Costing linked to that file.
- [ ] Quotation linked to costing and file.
- [ ] Advance invoice linked to quotation and file.
- [ ] Final invoice recognizes the advance correctly.
- [ ] Cash request linked to the same file.
- [ ] Delivery note linked to the same file.
- [ ] Payslip generated from a completed payroll run.
- [ ] Accounting/journals show the financial trail.
- [ ] Major document PDFs, references, and statuses shown.

---

## Recommended recording chapters

1. **Setup:** employees, roles, corporate entity, client, and supplier.
2. **Commercial and operations:** operations file, costing, and quotation.
3. **Billing and execution:** advance invoice, final invoice, cash request, and delivery note.
4. **Payroll and accounting proof:** payroll run, payslip, and journal/receivable traceability.
