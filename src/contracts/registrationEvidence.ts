export type RegistrationEvidenceRole = "passport" | "identity_photo" | "registration" | "laboratory" | "other";
export interface RegistrationEvidenceRecord {
  id: string;
  request_id: string;
  role: RegistrationEvidenceRole;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  verification: "unreviewed";
  public_visible: false;
}
export interface RegistrationEvidenceUploadInput {
  role: RegistrationEvidenceRole;
  file_name: string;
  mime_type: string;
  data_base64: string;
  /** Keep the same key when retrying an ambiguous response. */
  operation_id: string;
}
export interface RegistrationEvidenceListResponse {
  request_id: string;
  evidence: RegistrationEvidenceRecord[];
  can_edit: boolean;
  limits: { max_file_bytes: number; max_files: number; max_total_bytes: number };
}
