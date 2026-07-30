-- Data integrity: line items must reference a real catalogue row (like po_item
-- already does) so records reconcile and nobody can free-type arbitrary text.
-- `label`/`item` stays as a denormalised display snapshot of the chosen row.
ALTER TABLE purchase_request_line ADD COLUMN IF NOT EXISTS dictionary_item_id uuid REFERENCES dictionary_item(dictionary_item_id);
ALTER TABLE grn_line              ADD COLUMN IF NOT EXISTS inventory_item_id  uuid REFERENCES inventory_item(inventory_item_id);
ALTER TABLE delivery_note_line    ADD COLUMN IF NOT EXISTS inventory_item_id  uuid REFERENCES inventory_item(inventory_item_id);
ALTER TABLE transit_order_line    ADD COLUMN IF NOT EXISTS inventory_item_id  uuid REFERENCES inventory_item(inventory_item_id);
