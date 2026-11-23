/** A row count is not evidence of origin, ownership, or permission to show records. */
export function datasetClassification(env: { REGISTRY_DATASET_KIND?: string }, horseCount: number): {
  dataMode: "client" | "demo" | "empty";
  datasetProvenance: "synthetic" | "declared_client" | "unspecified";
} {
  const kind = env.REGISTRY_DATASET_KIND;
  const datasetProvenance = kind === "synthetic" ? "synthetic" : kind === "client" ? "declared_client" : "unspecified";
  // Keep the legacy dataMode vocabulary. "client" means nonempty and not explicitly
  // marked synthetic; it does NOT attest record rights, completeness, or verification.
  return { dataMode: horseCount > 0 ? (kind === "synthetic" ? "demo" : "client") : "empty", datasetProvenance };
}
