import * as React from "react";
import { tenant } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/modal";
import { PageHeader } from "@/components/data-list";
import { HubCrumb, HubTabs } from "@/components/tabbed-hub";
import { ErrorState, LoadingRow } from "@/components/ui/states";
import { pageShell } from "@/lib/layout";
import { ScanAttachment } from "@/components/scan-attachment";
import { dateFmt } from "@/lib/format";

type Profile = Record<string, unknown>;
const list = (v: unknown) => Array.isArray(v) ? v.join(", ") : "";
export function CompanyProfilePage() {
 const [p,setP]=React.useState<Profile|null>(null),[error,setError]=React.useState<string|null>(null),[busy,setBusy]=React.useState(false);
 const load=React.useCallback(()=>tenant<Profile>("/company-profile").then(setP).catch(e=>setError(String(e))),[]);
 React.useEffect(()=>{void load();},[load]);
 const field=(key:string,value:string|string[])=>setP(x=>({...x!,[key]:value}));
 async function save(){setBusy(true);setError(null);try{await tenant("/company-profile",{method:"PUT",body:{slogan:p?.slogan||null,positioning:p?.positioning||null,operating_regions:String(p?.operating_regions||"").split(",").map(x=>x.trim()).filter(Boolean),gateways:String(p?.gateways||"").split(",").map(x=>x.trim()).filter(Boolean),memberships:String(p?.memberships||"").split(",").map(x=>x.trim()).filter(Boolean),certifications:String(p?.certifications||"").split(",").map(x=>x.trim()).filter(Boolean),source_document_id:p?.source_document_id||null}});await load();}catch(e){setError(String(e));}finally{setBusy(false)}}
 async function refresh(){setBusy(true);try{await tenant("/company-profile/refresh",{method:"POST"});await load();}finally{setBusy(false)}}
 if(!p&&!error)return <LoadingRow/>;
 return <section className={pageShell.wide}><PageHeader eyebrow={<HubCrumb area="Sales & CRM" to="/sales"/>} title="Company profile" description="Declared facts and SQL-derived operating evidence used to ground proposals." action={<Button onClick={refresh} loading={busy}>Refresh derived facts</Button>}/><HubTabs/>{error&&<ErrorState message={error}/>}<div className="grid gap-4 lg:grid-cols-2"><div className="lux-card space-y-3 p-4"><Field label="Slogan"><Input value={String(p?.slogan||"")} onChange={e=>field("slogan",e.target.value)}/></Field><Field label="Positioning"><Textarea value={String(p?.positioning||"")} onChange={e=>field("positioning",e.target.value)} rows={5}/></Field>{["operating_regions","gateways","memberships","certifications"].map(k=><Field key={k} label={k.replace(/_/g, " ")} hint="Comma separated"><Input value={typeof p?.[k]==="string"?String(p[k]):list(p?.[k])} onChange={e=>field(k,e.target.value)}/></Field>)}<Field label="Company profile PDF" hint="Upload a profile, copy the extracted facts into the same fields above, then confirm them."><ScanAttachment vaultId={p?.source_document_id ? String(p.source_document_id) : null} docType="ENTITY_DOCUMENT" entityRef={`company_profile:${String(p?.company_profile_id ?? "tenant")}`} onAttached={(id) => field("source_document_id", id)} onError={setError} /></Field><Button onClick={save} loading={busy}>Save and confirm</Button></div><div className="lux-card p-4"><p className="text-sm text-muted-foreground">As of {p?.computed_at?dateFmt(p.computed_at):"not computed"}</p><dl className="mt-4 grid grid-cols-2 gap-4"><div><dt>Active fleet</dt><dd className="text-2xl font-semibold">{String(p?.fleet_count??0)}</dd></div><div><dt>Warehouse capacity</dt><dd className="text-2xl font-semibold">{String(p?.warehouse_capacity??0)}</dd></div><div><dt>Clients</dt><dd className="text-2xl font-semibold">{String(p?.client_count??0)}</dd></div><div><dt>Turnover band</dt><dd className="text-2xl font-semibold">{String(p?.turnover_band??"—")}</dd></div></dl></div></div></section>;
}
