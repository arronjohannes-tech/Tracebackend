ALTER TABLE documents
  ADD COLUMN plot_id uuid,
  ADD CONSTRAINT documents_plot_organization_fk
    FOREIGN KEY (organization_id, plot_id)
    REFERENCES plots (organization_id, id) ON DELETE RESTRICT;

CREATE INDEX documents_organization_plot_idx ON documents (organization_id, plot_id);
