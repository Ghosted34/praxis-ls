-- Line-item detail for four documents that previously stored only a header, so
-- their generated documents (and the native detail view) show real content.
-- Each line cascades with its parent.

CREATE TABLE purchase_request_line (
  purchase_request_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id       uuid NOT NULL REFERENCES purchase_request(pr_id) ON DELETE CASCADE,
  label       text NOT NULL,
  qty         numeric(18,4) NOT NULL DEFAULT 1,
  unit_price  numeric(18,2) NOT NULL DEFAULT 0
);
CREATE INDEX idx_pr_line_pr ON purchase_request_line(pr_id);

CREATE TABLE delivery_note_line (
  delivery_note_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_note_id uuid NOT NULL REFERENCES delivery_note(delivery_note_id) ON DELETE CASCADE,
  label            text NOT NULL,
  qty              numeric(18,4) NOT NULL DEFAULT 1
);
CREATE INDEX idx_dn_line_dn ON delivery_note_line(delivery_note_id);

CREATE TABLE transit_order_line (
  transit_order_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transit_order_id uuid NOT NULL REFERENCES transit_order(transit_order_id) ON DELETE CASCADE,
  label            text NOT NULL,
  packages         numeric(18,4) NOT NULL DEFAULT 1,
  weight           text
);
CREATE INDEX idx_to_line_to ON transit_order_line(transit_order_id);

CREATE TABLE grn_line (
  grn_line_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_inbound_id  uuid NOT NULL REFERENCES grn_inbound(grn_inbound_id) ON DELETE CASCADE,
  item            text NOT NULL,
  ordered         numeric(18,4) NOT NULL DEFAULT 0,
  received        numeric(18,4) NOT NULL DEFAULT 0,
  condition       text
);
CREATE INDEX idx_grn_line_grn ON grn_line(grn_inbound_id);
