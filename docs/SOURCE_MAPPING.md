# Source XLSX → Canonical Mapping

The spreadsheet is an import format, not the runtime schema. This mapping is intentionally explicit so future client exports can be diffed and validated instead of silently changing application behavior.

| Source field | Canonical target | Notes |
|---|---|---|
| `HorseNo` | `horses.id` | Canonical immutable horse key. |
| `HorseNameL` | `horses.name_latin` | Required display/search name; `[unnamed]` only as importer fallback. |
| `HorseNameF` | `horses.name_native` | Persian/native name. |
| `FatherNo` | `horses.father_id` | Self-reference to `horses.id`; validated/cycle-safe in application. |
| `MotherNo` | `horses.mother_id` | Self-reference to `horses.id`. |
| `RegisterNo` | `horses.register_no` | Stored as TEXT, not numeric. |
| `MicroChipNo` | `horses.microchip_no` | Stored as TEXT to avoid scientific-notation/precision damage. |
| `FileNumber` | `horses.file_number` | Server/admin field. |
| `CompanyCode` | `horses.company_code` | Preserved canonical field. |
| `BookVersion` | `horses.book_version` | Preserved canonical field. |
| `IsActive` | `horses.is_active` | Normalized boolean integer. |
| `Originality` | `horses.originality` | Preserved canonical field. |
| `BirthDate` | `horses.birth_date` | Source text/date normalized to text representation. |
| `BirthYear` | `horses.birth_year` | Integer when coercible; anomalies quality-flagged rather than silently rewritten. |
| `BirthPlace` | `horses.birth_place_code` | Code. |
| `BirthPlaceDesc` | `horses.birth_place_desc` | Display/search description. |
| `BreedType` | `horses.breed_type` | Code/value. |
| `BreedTypeDesc` | `horses.breed_desc` | Display/search description. |
| `SexNo` / `SexDesc` | `sex_code` / `sex_desc` | Canonical fields. |
| `ColorNo` / `ColorDesc` | `color_code` / `color_desc` | Canonical fields. |
| `MainStrainNo` / `MainStrainDesc` | corresponding `main_strain_*` | Canonical/search fields. |
| `SubStrainNo` / `SubStrainDesc` | corresponding `sub_strain_*` | Canonical/search fields. |
| `UELNo` | `horses.uel_no` | TEXT identifier. |
| `LabNo` | `horses.lab_no` | Server/admin field. |
| `DNAStatus` / `DNADesc` | `dna_status` / `dna_desc` | Preserved canonical fields. |
| `LifeNumber` | `horses.life_number` | TEXT identifier. |
| `PassportNo` | `horses.passport_no` | Server/admin field by default. |
| `PassportDate` | `horses.passport_date` | Preserved. |
| `PassportDeliverDate` | `horses.passport_deliver_date` | Preserved. |
| `IsStallion` | `horses.is_stallion` | Boolean. |
| `IsSport` | `horses.is_sport` | Boolean. |
| `IsImported` | `horses.is_imported` | Boolean. |
| `ImportedDate` | `horses.imported_date` | Preserved. |
| `ImportedFrom` / `ImportedFromDesc` | `imported_from_code` / `imported_from_desc` | Canonical/search place fields. |
| `ImportRegisterNo` | `horses.import_register_no` | TEXT. |
| `ExportCertificate` | `horses.export_certificate` | Preserved. |
| `HorseSRNo` | `horses.horse_sr_no` | Preserved as TEXT. |
| `IsDie` / `DeathDate` | `is_dead` / `death_date` | Canonical status. |
| `IsRegisterSport` | `horses.is_register_sport` | Boolean. |
| `IsHasSportCard` | `horses.has_sport_card` | Boolean. |
| `IsAllowStallion` | `horses.allow_stallion` | Boolean. |
| `Description` | `horses.description` | **Admin-only by default** pending privacy/client review. |
| `CreateDateTime` | `horses.source_created_at` | Source-system timestamp. |
| `OwnerNo` + owner name fields | `people` + `horse_people(role='owner')` | Owner ID normalized as a reusable person/entity record. |
| `BreederNo` + breeder name fields | `people` + `horse_people(role='breeder')` | Same person table, separate role edge. |
| `ImporterNo` / `PassportReceiverNo` | reserved canonical relationship semantics | IDs are recognized source fields but richer role/name semantics require source/domain confirmation before automatic public use. |
| `ShajF1..28` / `ShajNoF1..28` | **not imported** | Redundant fixed-depth ancestry cache; canonical pedigree is regenerated from father/mother links. |
| Other unknown source columns | `horses.raw_json` locally | Private preservation only; omitted from cloud D1 shards by default. |

## Mapping rules

1. Identifiers are TEXT unless they are truly relational numeric IDs such as `HorseNo`, `FatherNo`, `MotherNo`, owner/breeder IDs.
2. Source anomalies are preserved + quality-flagged rather than guessed/fixed silently.
3. New unknown source columns do not become public fields automatically.
4. A future workbook refresh should be imported into a second canonical snapshot and compared with `tools/compare_canonical.py` before any production mutation.
5. Any source header rename/removal affecting a canonical field is a migration/import-review event, not something the importer should silently infer.
