ALTER TABLE shipments
  ADD CONSTRAINT shipments_organization_id_id_unique UNIQUE (organization_id, id);

ALTER TABLE plots
  ADD COLUMN shipment_id uuid,
  ADD CONSTRAINT plots_shipment_organization_fk
    FOREIGN KEY (organization_id, shipment_id)
    REFERENCES shipments (organization_id, id) ON DELETE RESTRICT;

CREATE INDEX plots_shipment_idx ON plots (organization_id, shipment_id)
  WHERE shipment_id IS NOT NULL;
