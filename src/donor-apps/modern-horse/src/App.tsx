import { Component, lazy, Suspense, type ReactNode, useEffect, useRef, useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { BreedingProvider } from './store';
import { useMedia, useRoute } from './lib';
import { BottomNav, Sidebar, Topbar } from './components/Shell';
import { Welcome } from './pages/Welcome';
import { Registry } from './pages/Registry';
import { AppearanceProvider } from './appearance';
import { RoleProvider } from './role';

const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({default:m.Dashboard})));
const HorseDetail = lazy(() => import('./pages/HorseDetail').then(m => ({default:m.HorseDetail})));
const Breeding = lazy(() => import('./pages/Breeding').then(m => ({default:m.Breeding})));
const SportPage = lazy(() => import('./pages/SportPage').then(m => ({default:m.SportPage})));
const Services = lazy(() => import('./pages/Services').then(m => ({default:m.Services})));
const Admin = lazy(() => import('./pages/Admin').then(m => ({default:m.Admin})));
const Roadmap = lazy(() => import('./pages/Roadmap').then(m => ({default:m.Roadmap})));
const Platform = lazy(() => import('./pages/Platform').then(m => ({default:m.Platform})));
const People = lazy(() => import('./pages/People').then(m => ({default:m.People})));
const NewsPage = lazy(() => import('./pages/News').then(m => ({default:m.NewsPage})));

class PageBoundary extends Component<{children:ReactNode; fallback:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
function Shell() {
  const {tx}=useI18n();
  const full = useRoute();
  const [path, qs] = full.split('?');
  const query = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rail') === '1');
  const [drawer, setDrawer] = useState(false);
  const wide = useMedia('(min-width:1024px)');
  useEffect(() => { if(wide)setDrawer(false); }, [wide]);
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    setDrawer(false);
    main.current?.scrollTo({ top: 0 });
  }, [path]);
  useEffect(() => localStorage.setItem('rail', collapsed ? '1' : '0'), [collapsed]);

  let page;
  switch (parts[0]) {
    case 'horses':
      if (!parts[1]) page = <Registry tab="search" query={query} />;
      else if (parts[1] === 'register') page = <Registry tab="register" query={query} />;
      else page = <HorseDetail id={parts[1]} tab={parts[2] || 'overview'} />;
      break;
    case 'breeding':
      page = <Breeding tab={parts[1] === 'ancestry' ? 'ancestry' : parts[1] === 'matches' ? 'matches' : parts[1] === 'genetics' ? 'genetics' : 'advisor'} />;
      break;
    case 'people':
      page = <People tab={parts[1] === 'breeders' ? 'breeders' : parts[1] === 'orgs' ? 'orgs' : 'riders'} query={query} />;
      break;
    case 'news':
      page = <NewsPage sel={query.get('n')} />;
      break;
    case 'sport':
      page = <SportPage tab={parts[1] === 'rankings' ? 'rankings' : parts[1] === 'events' ? 'events' : parts[1] === 'sources' ? 'sources' : 'results'} />;
      break;
    case 'services':
      page = <Services tab={parts[1] === 'market' ? 'market' : parts[1] === 'farm' ? 'farm' : parts[1] === 'process' ? 'process' : 'directory'} />;
      break;
    case 'admin':
      page = <Admin tab={(parts[1] as 'queue') || 'overview'} />;
      break;
    case 'platform':
      page = <Platform />;
      break;
    case 'roadmap':
      page = <Roadmap />;
      break;
    case 'dashboard':
      page = <Dashboard />;
      break;
    default:
      page = <Welcome />;
  }

  return (
    <div className="app-root flex overflow-hidden bg-canvas">
      <Sidebar path={path} collapsed={collapsed} onCollapse={() => setCollapsed((c) => !c)} open={drawer} onClose={() => setDrawer(false)} />
      <div inert={drawer && !wide} className="app-glow flex min-w-0 flex-1 flex-col">
        <Topbar path={path} />
        <main ref={main} className="thin-scroll min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
          <PageBoundary key={parts[0] || '/'} fallback={<section className="panel m-3 p-4" role="alert"><p>{tx('This page could not open.', 'این صفحه باز نشد.')}</p><button className="min-h-11" onClick={()=>location.reload()}>{tx('Reload page','بارگذاری دوباره')}</button></section>}>
            <Suspense fallback={<p className="p-4 text-sm" role="status">{tx('Loading page…','در حال بارگذاری صفحه…')}</p>}>{page}</Suspense>
          </PageBoundary>
        </main>
        <BottomNav open={drawer && !wide} path={path} onMore={() => setDrawer(true)} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppearanceProvider>
      <RoleProvider>
        <BreedingProvider>
          <Shell />
        </BreedingProvider>
      </RoleProvider>
      </AppearanceProvider>
    </I18nProvider>
  );
}
