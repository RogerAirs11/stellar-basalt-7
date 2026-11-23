import type { AiCompleteness,AiEntityReference,AiEvidence,AiEvidenceKind } from "../core/types";

/** Provider/runtime-neutral evidence envelope. Domain-specific link builders live under the project domain adapter tree. */
export function evidence(kind:AiEvidenceKind,title:string,sourceRef:string,payload:unknown,entityRefs:AiEntityReference[]=[],completeness?:AiCompleteness):AiEvidence{
  return{id:crypto.randomUUID(),kind,title,sourceRef,payload,entityRefs,completeness};
}
