import { useEffect } from 'react';
import { retroText } from './i18n/messages';
import { MotionConfig, motion } from 'motion/react';
import { usePrincipalScope, type FrontendRuntimeProps } from '../../../../frontend-kit';
import { Shell } from './components/Shell';
import { WorkspaceModals } from './components/WorkspaceModals';
import { WorkspaceProvider } from './lib/Workspace';
import { useRoute } from './lib/hooks';
import { Home } from './pages/Home';
import { Directory } from './pages/Directory';
import { Profile } from './pages/Profile';
import { Pedigree } from './pages/Pedigree';
import { PlatformDesk } from './pages/PlatformDesk';
import { Insights } from './pages/Insights';
import { Newsroom } from './pages/Newsroom';
import { Assistant } from './pages/Assistant';
import './styles/newsroom.css';
import { PreferencesProvider, usePreferences } from './preferences/PreferencesProvider';
import { HorseDbAdapterProvider, useHorseDbAdapter } from './HorseDbAdapter';
import { RetroAstraProfileEditor } from '../ProfileEditor';
import { RetroAstraOrganizationEditor } from '../OrganizationEditor';
import { RetroAstraWorkspaceDesk } from '../WorkspaceDesk';
import { positiveEditorTarget } from '../EditorControls';
import './styles/editors.css';
import { DirectoryDesk } from './pages/DirectoryDesk';
import { ServiceDesk } from './pages/ServiceDesk';

function StudbookWorkspace({ hostRoute }: { hostRoute: string }) {
  const route = useRoute(hostRoute);
  const { t, language } = usePreferences();
  const { runtime } = useHorseDbAdapter();
  const scope = usePrincipalScope(runtime.user, runtime.permissions);
  const editorTarget = route.id ? positiveEditorTarget(route.id) : null;
  // The service workbench retains per-request command locks while selecting details.
  const key = route.page === 'services' ? 'services' : `${route.page}/${route.id ?? ''}/${route.query}/${route.filter}/${route.person ?? ''}`;
  useEffect(() => {
    const titles = { home: 'welcome', horses: 'directory', profile: 'horseRecord', pedigree: 'pedigree', collections: 'collections', newsroom: 'newsroom', insights: 'insights', assistant: 'assistant', 'directory-profile': 'directory', 'organization-profile': 'collections', workspaces: 'collections', directory: 'directory', services: 'collections' } as const;
    const nativeTitle = route.page === 'services' ? (retroText(language, 'Service requests', 'درخواست‌های خدمت')) : route.page === 'directory' ? (retroText(language, 'Professional directory', 'فهرست متخصصان')) : null;
    document.title = `${t('appName')} | ${nativeTitle ?? t(titles[route.page])}`;
  }, [route.page, t, language]);
  return <>
    <Shell route={route}>
      <motion.div key={key} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.26, ease: 'easeOut' }}>
        {route.page === 'home' && <Home />}
        {route.page === 'horses' && <Directory route={route} />}
        {route.page === 'profile' && <Profile horseId={route.id ?? ''} />}
        {route.page === 'pedigree' && <Pedigree horseId={route.id} />}
        {route.page === 'collections' && <PlatformDesk section={route.id} personId={route.person} />}
        {route.page === 'newsroom' && <Newsroom />}
        {route.page === 'insights' && <Insights />}
        {route.page === 'assistant' && <Assistant route={route} />}
        {route.page === 'directory-profile' && <RetroAstraProfileEditor personId={editorTarget} invalidTarget={!!route.id && editorTarget === null} platform={runtime.platform} scope={scope} signedIn={!!runtime.user} />}
        {route.page === 'organization-profile' && <RetroAstraOrganizationEditor organizationId={editorTarget} invalidTarget={!!route.id && editorTarget === null} platform={runtime.platform} scope={scope} signedIn={!!runtime.user} user={runtime.user} />}
        {route.page === 'workspaces' && <RetroAstraWorkspaceDesk workspaceId={route.id && /^[1-9][0-9]*$/.test(route.id) ? Number(route.id) : null} invalidTarget={!!route.id && !(/^[1-9][0-9]*$/.test(route.id ?? ''))} platform={runtime.platform} signedIn={!!runtime.user} user={runtime.user} />}
        {route.page === 'directory' && <DirectoryDesk personId={route.id} />}
        {route.page === 'services' && <ServiceDesk requestId={route.id} />}
      </motion.div>
    </Shell>
    <WorkspaceModals />
  </>;
}

export function RetroAstraDonorTransplant({runtime}:{runtime:FrontendRuntimeProps}) {
  return <div className="retro-astra-transplant" data-source-preview={document.documentElement.dataset.sourcePreview === 'true' ? 'true' : undefined}>
    <MotionConfig reducedMotion="user">
      <PreferencesProvider hostLocale={runtime.locale} onSetHostLocale={locale => runtime.setLocale(locale)}>
        <HorseDbAdapterProvider runtime={runtime}>
          <WorkspaceProvider><StudbookWorkspace hostRoute={runtime.route} /></WorkspaceProvider>
        </HorseDbAdapterProvider>
      </PreferencesProvider>
    </MotionConfig>
  </div>;
}
