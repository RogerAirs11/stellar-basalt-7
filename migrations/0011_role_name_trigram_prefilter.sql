-- Rebuildable trigram prefilter for expensive registry role-name substring filters.
-- The canonical horse_people/people EXISTS + LIKE predicate remains the final
-- authority; this FTS table only narrows candidate horse IDs while analytics
-- derived state is current.
CREATE VIRTUAL TABLE IF NOT EXISTS horse_role_search_trigram USING fts5(
  owner,
  breeder,
  importer,
  passport_receiver,
  tokenize = 'trigram'
);
