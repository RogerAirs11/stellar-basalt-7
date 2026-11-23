import { BookOpen, GitFork, Heart, ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../lib/Workspace';
import { usePreferences } from '../preferences/PreferencesProvider';
import { AppearanceSettings } from './AppearanceSettings';
import { Button, Modal } from './ui';
import { CommandPalette, HorsePreview } from './DeskTools';
function FieldGuide(){const {closeModal}=useWorkspace();const {t,language}=usePreferences();const rows=[
  {Icon:BookOpen,en:'Find canonical records',fa:'یافتن پرونده‌های رسمی',bodyEn:'Search and filter the live Horse DB registry. Open a name for the full canonical record.',bodyFa:'سامانه ثبت زنده Horse DB را جست‌وجو و پالایش کنید و پرونده رسمی هر اسب را باز کنید.'},
  {Icon:GitFork,en:'Explore pedigree',fa:'کاوش تبارنامه',bodyEn:'Use the donor classic, vertical, fan and generation-register views with canonical ancestry.',bodyFa:'نمای کلاسیک، عمودی، بادبزنی و دفتر نسل‌ها را با تبار رسمی به کار ببرید.'},
  {Icon:ShieldCheck,en:'Governed actions',fa:'اقدامات حاکمیتی',bodyEn:'Claims, change requests and privileged admin operations remain permission-gated.',bodyFa:'ادعاها، درخواست‌های تغییر و عملیات مدیریتی همچنان بر اساس مجوز کنترل می‌شوند.'},
  {Icon:Heart,en:'Your desk, not another database',fa:'میز شما، نه پایگاه داده‌ای دیگر',bodyEn:'Only visual preferences are stored locally. Horse-domain truth stays on the platform.',bodyFa:'فقط تنظیمات ظاهری محلی است؛ حقیقت حوزه اسب روی پلتفرم می‌ماند.'},
];return <Modal title={language==='fa'?'راهنمای میز Horse DB':'Horse DB desk guide'} subtitle={t('guideDescription')} onClose={closeModal}><div className="quick-guide">{rows.map(({Icon,en,fa,bodyEn,bodyFa})=><div key={en}><Icon/><section><h3>{language==='fa'?fa:en}</h3><p>{language==='fa'?bodyFa:bodyEn}</p></section></div>)}<div className="guide-footer"><span>{t('fictionalPossibilities')}</span><Button variant="primary" onClick={closeModal}>{t('done')}</Button></div></div></Modal>}
export function WorkspaceModals(){const {modal}=useWorkspace();if(!modal)return null;switch(modal.type){case'command':return <CommandPalette/>;case'preview':return <HorsePreview horseId={modal.horseId??''}/>;case'settings':return <AppearanceSettings/>;case'help':return <FieldGuide/>;default:return null;}}
