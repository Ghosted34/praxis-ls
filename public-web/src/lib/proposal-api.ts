/**
 * A shared commercial proposal — `GET /api/tenant/public/proposals/:token`.
 *
 * The token in the URL is the ONLY credential. It is the record's minted public
 * token, never its id: ids appear in staff URLs and in logs, so accepting one
 * here would turn every internal identifier into a sharing credential. The same
 * rule is why nothing in this app builds a proposal URL out of anything but a
 * token it was handed.
 *
 * The server sends a PRESENTATION, not raw rows — titles, section bodies,
 * line labels and already-formatted money (`unit_price_display`,
 * `total_display`). This page must not re-format any of it: the PDF is rendered
 * server-side from the same object, and a client who prints the page and a
 * client who downloads the file have to be reading the same document. Formatting
 * it here would guarantee they drift.
 */
import { publicGet } from "./api";

export type ProposalPresentation = {
  language: "EN" | "FR";
  title: string;
  document_number: string;
  client_name: string;
  route: string;
  labels: {
    service: string;
    quantity: string;
    unit: string;
    total: string;
  };
  sections: { key: string; title: string; body: string }[];
  lines: {
    label: string;
    quantity: number;
    unit_price_display: string;
    total_display: string;
  }[];
};

export type ProposalPayload = { presentation: ProposalPresentation };

export const getProposal = (token: string, lang: "EN" | "FR") =>
  publicGet<ProposalPayload>(`/public/proposals/${encodeURIComponent(token)}`, {
    query: { lang },
  });

/** The link the browser navigates to (not a fetch): the server streams the PDF
 *  with a Content-Disposition, so an `<a>` is what makes Save-As work instead of
 *  an inline blob the reader cannot keep. It carries the language the PRESENTATION
 *  came back in, so a reader who switched EN→FR does not download the other one. */
export const proposalPdfUrl = (token: string, lang: "EN" | "FR") =>
  `/api/tenant/public/proposals/${encodeURIComponent(token)}/pdf?lang=${lang}`;
