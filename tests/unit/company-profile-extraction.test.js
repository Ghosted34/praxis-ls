"use strict";

jest.mock("../../src/modules/vault/document_vault/document_vault.service", () => ({
  fetchBytes: jest.fn(),
}));
jest.mock("../../src/services/ai/vision.service", () => ({ extract: jest.fn() }));
jest.mock("../../src/modules/ai/governance/governance.service", () => ({
  canUseFeature: jest.fn(), getVendorConfig: jest.fn(), recordUsage: jest.fn(),
}));
jest.mock("../../src/modules/sales/company_profile/company_profile.repo", () => ({}));
jest.mock("../../src/shared/events/emit", () => ({ audit: jest.fn() }));

const documents=require("../../src/modules/vault/document_vault/document_vault.service");
const vision=require("../../src/services/ai/vision.service");
const governance=require("../../src/modules/ai/governance/governance.service");
const service=require("../../src/modules/sales/company_profile/company_profile.service");

beforeEach(()=>{
 jest.clearAllMocks();
 documents.fetchBytes.mockResolvedValue({doc:{storage_path:"tenant_x/vault/profile.pdf"},buffer:Buffer.from("%PDF-profile")});
 governance.canUseFeature.mockResolvedValue({allowed:true});
 governance.getVendorConfig.mockResolvedValue({api_key:"test",model:"mock-model"});
 governance.recordUsage.mockResolvedValue({});
});

describe("F2 profile document extraction",()=>{
 test("live extraction is governed, strictly validated, metered and only suggested",async()=>{
  vision.extract.mockResolvedValue({provider:"gemini",fields:{slogan:"Beyond",memberships:["WCA"]}});
  const out=await service.extractDocument({}, {documentId:"doc",actor:{user_id:"u1"},env:"live"});
  expect(governance.canUseFeature).toHaveBeenCalledWith({}, {userId:"u1",featureKey:"doc_vision"});
  expect(governance.recordUsage).toHaveBeenCalledWith({},expect.objectContaining({featureKey:"doc_vision",callType:"company_profile_extraction",wasSuccessful:true}));
  expect(out).toMatchObject({suggestions:{slogan:"Beyond",memberships:["WCA"]},requires_confirmation:true,sandbox:false});
 });
 test("sandbox uses the zero-credit mock path",async()=>{
  const out=await service.extractDocument({}, {documentId:"doc",actor:{user_id:"u1"},env:"sandbox"});
  expect(out).toMatchObject({suggestions:{},provider:"mock",sandbox:true,requires_confirmation:true});
  expect(vision.extract).not.toHaveBeenCalled(); expect(governance.recordUsage).not.toHaveBeenCalled();
 });
 test("invented or malformed fields are refused rather than saved",async()=>{
  vision.extract.mockResolvedValue({provider:"gemini",fields:{turnover:999,unknown_claim:"invented"}});
  await expect(service.extractDocument({}, {documentId:"doc",actor:{user_id:"u1"},env:"live"})).rejects.toMatchObject({code:"INVALID_EXTRACTION"});
  expect(governance.recordUsage).toHaveBeenCalledWith({},expect.objectContaining({wasSuccessful:false,errorCode:"INVALID_EXTRACTION"}));
 });
 test("a governance refusal spends nothing",async()=>{
  governance.canUseFeature.mockResolvedValue({allowed:false,reason:"hard cap reached"});
  await expect(service.extractDocument({}, {documentId:"doc",actor:{user_id:"u1"},env:"live"})).rejects.toMatchObject({code:"AI_UNAVAILABLE"});
  expect(vision.extract).not.toHaveBeenCalled(); expect(governance.recordUsage).not.toHaveBeenCalled();
 });
});
