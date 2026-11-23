import { z } from 'zod';
import { requireAuth, requireCsrf } from '../../auth/guards';
import { HttpError, json, readJson } from '../http';
import { careCapability, carePermissions, requireCareEnabled, type CareContext, type CareEnvironment } from '../../equineCare/access';
import { ClinicalSchema,ClinicalAmendSchema,ReproductionSchema,ReproductionAmendSchema,SampleSchema,CustodySchema,ReportSchema,ReportReviewSchema,validated } from '../../equineCare/validation';
import { createClinicalEvent,amendClinicalEvent } from '../../equineCare/clinical';
import { saveReproductiveEpisode } from '../../equineCare/reproduction';
import { createSample,appendCustodyEvent,createLabReport,reviewLabReport } from '../../equineCare/laboratory';
import { readCareRecords,readCareHistory,readSampleCustody,type CareCollection } from '../../equineCare/queries';
import { reviewedBaseColorProjection,reviewedStrComparison } from '../../equineCare/analysis';

/** Unique dispatch entry point. Integrate before generic horse routes.
 * All responses use the shared private,no-store JSON policy. */
export async function routeEquineCare(request:Request,env:CareEnvironment,url:URL):Promise<Response|null> {
  const path=url.pathname;
  const match=/^\/api\/horses\/(\d+)\/care\/(clinical|reproduction|samples|reports)(?:\/([0-9a-f-]{36}))?(?:\/(history|custody|review))?$/.exec(path);
  if(!match && path!=='/api/care/capabilities' && path!=='/api/care/analysis/base-color' && path!=='/api/care/analysis/str-parentage')return null;
  const auth=await requireAuth(env.DB,request,env.SESSION_COOKIE_NAME);
  if(path==='/api/care/capabilities') {
    if(request.method!=='GET')throw new HttpError(405,'method_not_allowed','Use GET for capabilities');
    const raw=url.searchParams.get('horse_id');
    const horseId=raw && /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw))?Number(raw):null;
    if(raw && !horseId)throw new HttpError(400,'invalid_horse_id','horse_id must be a positive integer');
    const capability=careCapability(env);
    return json({...capability,horse_id:horseId,permissions:capability.enabled&&horseId?await carePermissions({db:env.DB,auth,horseId}):[]});
  }
  requireCareEnabled(env);requireCsrf(request,auth);
  if(path==='/api/care/analysis/base-color' || path==='/api/care/analysis/str-parentage') {
    if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST for private analysis');
    const schema=z.object({sire_id:z.number().int().positive(),dam_id:z.number().int().positive(),...(path.endsWith('str-parentage')?{child_id:z.number().int().positive()}:{})}).strict();
    const input=validated(schema,await readJson<unknown>(request,8192));
    const context={db:env.DB,auth,horseId:input.dam_id};
    return json(path.endsWith('base-color')?await reviewedBaseColorProjection(context,input.sire_id,input.dam_id):await reviewedStrComparison(context,Number((input as {child_id?:number}).child_id),input.sire_id,input.dam_id));
  }
  const horseId=Number(match![1]);if(!Number.isSafeInteger(horseId)||horseId<=0)throw new HttpError(400,'invalid_horse_id','Invalid horse id');
  const collection=match![2] as CareCollection,id=match![3],action=match![4];
  const context:CareContext={db:env.DB,auth,horseId};
  if(request.method==='GET') {
    if(id && action==='history')return json(await readCareHistory(context,collection,id));
    if(id && collection==='samples' && action==='custody')return json(await readSampleCustody(context,id));
    if(action)throw new HttpError(405,'method_not_allowed','This action does not support GET');
    const offset=Number(url.searchParams.get('offset')??0);
    if(!Number.isInteger(offset)||offset<0||offset>10000)throw new HttpError(400,'invalid_offset','offset must be an integer from 0 to 10000');
    return json(await readCareRecords(context,collection,id,offset));
  }
  const body=await readJson<unknown>(request,64*1024);
  if(request.method==='POST'&&!id&&!action){
    const receipt=collection==='clinical'?await createClinicalEvent(context,validated(ClinicalSchema,body))
      :collection==='reproduction'?await saveReproductiveEpisode(context,validated(ReproductionSchema,body))
      :collection==='samples'?await createSample(context,validated(SampleSchema,body))
      :await createLabReport(context,validated(ReportSchema,body));
    return json({receipt},{status:201});
  }
  if(request.method==='PATCH' && id && !action && collection==='clinical')return json({receipt:await amendClinicalEvent(context,id,validated(ClinicalAmendSchema,body))});
  if(request.method==='PATCH' && id && !action && collection==='reproduction')return json({receipt:await saveReproductiveEpisode(context,validated(ReproductionAmendSchema,body),id)});
  if(request.method==='POST' && id && action==='custody' && collection==='samples')return json({receipt:await appendCustodyEvent(context,id,validated(CustodySchema,body))},{status:201});
  if(request.method==='POST' && id && action==='review' && collection==='reports')return json({receipt:await reviewLabReport(context,id,validated(ReportReviewSchema,body))});
  throw new HttpError(405,'method_not_allowed','This care action does not support the requested method');
}
