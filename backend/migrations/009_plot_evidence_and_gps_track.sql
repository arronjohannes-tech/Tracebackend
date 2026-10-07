ALTER TABLE documents
  ADD CONSTRAINT documents_organization_id_id_unique UNIQUE (organization_id, id);

ALTER TABLE plots
  ADD COLUMN document_id uuid,
  ADD COLUMN track_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT plots_document_organization_fk
    FOREIGN KEY (organization_id, document_id)
    REFERENCES documents (organization_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT plots_track_points_array_check
    CHECK (jsonb_typeof(track_points) = 'array');
