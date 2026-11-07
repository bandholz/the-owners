-- Which saved group Home selects on load. "Hosts" until an admin changes it.
-- Empty string means select no one.
ALTER TABLE heatmap_settings ADD COLUMN default_group_name TEXT NOT NULL DEFAULT 'Hosts';
