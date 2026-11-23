import type { D1Database } from "@cloudflare/workers-types";
import type { DirectoryManagedProfileResponse } from "../contracts/platform";
import { parseServiceCategories, PROVINCE_CODE_SCHEME, publicProvince } from "./vocabulary";
/** One authoritative query gates unpublished profile state and field access.
 * Editorial permission can curate a profile, not inspect or change its private
 * contact route. That field belongs to the currently verified representative. */
export async function managedProfile(db: D1Database, actorId: string, personId: number): Promise<DirectoryManagedProfileResponse | null> {
    const row = await db.prepare(`SELECT p.id AS person_id,p.name_latin,p.name_native,
    COALESCE(d.row_version,0) AS row_version,d.service_categories,d.province_code,d.province_code_scheme,
    d.city,COALESCE(d.contact_preference,'platform_message') AS contact_preference,
    d.languages,d.availability_text,COALESCE(d.publication_consent,0) AS publication_consent,d.published_at,
    CASE WHEN EXISTS(SELECT 1 FROM user_person_links l WHERE l.person_id=p.id AND l.user_id=u.id AND l.status='verified') THEN d.contact_value ELSE NULL END AS contact_value,
    CASE WHEN EXISTS(SELECT 1 FROM user_person_links l WHERE l.person_id=p.id AND l.user_id=u.id AND l.status='verified') THEN 1 ELSE 0 END AS represents_person
    FROM people p JOIN users u ON u.id=? LEFT JOIN directory_profiles d ON d.person_id=p.id
    WHERE p.id=? AND p.deleted_at IS NULL AND u.is_active=1
      AND (u.role IN ('editor','admin','super_admin') OR EXISTS(SELECT 1 FROM user_person_links l WHERE l.person_id=p.id AND l.user_id=u.id AND l.status='verified'))`)
        .bind(actorId, personId).first<{
        person_id: number;
        name_latin: string | null;
        name_native: string | null;
        row_version: number;
        service_categories: string | null;
        province_code: string | null;
        province_code_scheme: string | null;
        city: string | null;
        contact_preference: "platform_message" | "phone" | "email";
        contact_value: string | null;
        languages: string | null;
        availability_text: string | null;
        publication_consent: number;
        published_at: string | null;
        represents_person: number;
    }>();
    if (!row)
        return null;
    return {
        profile: { person_id: row.person_id, name_latin: row.name_latin, name_native: row.name_native,
            row_version: row.row_version, service_categories: parseServiceCategories(row.service_categories),
            ...publicProvince(row.province_code, row.province_code_scheme), city: row.city,
            contact_preference: row.contact_preference, contact_value: row.contact_value,
            languages: row.languages, availability_text: row.availability_text,
            publication_consent: row.publication_consent === 1, published_at: row.published_at },
        permissions: { edit: true, initial_publication: row.represents_person === 1, private_contact: row.represents_person === 1 },
        current_province_scheme: PROVINCE_CODE_SCHEME,
    };
}
