import { Suspense, lazy, useEffect } from 'react';
import { APP_NAME, REPO_URL } from './config';
import { Home } from './ui/Home';
import { Review } from './ui/Review';
import { IconMoon, IconSun } from './ui/icons';
import { href, useRoute } from './ui/router';
import { useTheme } from './ui/theme';

// The games list and the review are where visits start; the other pages load when first opened.
const Insights = lazy(() => import('./ui/Insights').then((m) => ({ default: m.Insights })));
const Dictionary = lazy(() => import('./ui/Dictionary').then((m) => ({ default: m.Dictionary })));
const About = lazy(() => import('./ui/About').then((m) => ({ default: m.About })));
const Report = lazy(() => import('./ui/Report').then((m) => ({ default: m.Report })));

export function App() {
  const route = useRoute();
  const [section, a, b] = route;
  const [theme, toggleTheme] = useTheme();

  let page;
  let title = `${APP_NAME}: free chess game review`;
  if (section === 'game' && a) {
    page = <Review id={a} startPly={b ? Number(b) || 0 : undefined} />;
    title = `Review | ${APP_NAME}`;
  } else if (section === 'insights') {
    page = <Insights />;
    title = `Insights | ${APP_NAME}`;
  } else if (section === 'dictionary') {
    page = <Dictionary kind={a} id={b} />;
    title = `Dictionary | ${APP_NAME}`;
  } else if (section === 'about') {
    page = <About />;
    title = `How it works | ${APP_NAME}`;
  } else if (section === 'report') {
    page = <Report gameId={a === 'game' ? b : undefined} ply={a === 'game' && route[3] ? Number(route[3]) || undefined : undefined} />;
    title = `Report a bug | ${APP_NAME}`;
  } else {
    page = <Home />;
  }

  const key = route.slice(0, 2).join('/');
  useEffect(() => {
    document.title = title;
    window.scrollTo(0, 0);
  }, [key, title]);

  const reportHref = section === 'game' && a ? href('report', 'game', a, ...(b ? [b] : [])) : href('report');

  return (
    <div className={section === 'game' ? 'shell is-review' : 'shell'}>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href={href()} aria-label={APP_NAME}>
            <span className="roundel" aria-hidden="true">
              <b>!!</b>
            </span>
            {APP_NAME}
          </a>
          <nav className="nav" aria-label="Main">
            <a href={href()} aria-current={!section || section === 'game' ? 'page' : undefined}>
              <i aria-hidden="true" />
              Games
            </a>
            <a href={href('insights')} aria-current={section === 'insights' ? 'page' : undefined}>
              <i aria-hidden="true" />
              Insights
            </a>
            <a href={href('dictionary')} aria-current={section === 'dictionary' ? 'page' : undefined}>
              <i aria-hidden="true" />
              Dictionary
            </a>
          </nav>
          <button
            className="theme-btn"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'night' ? 'Switch to day colours' : 'Switch to night colours'}
            title={theme === 'night' ? 'Day colours' : 'Night colours'}
          >
            {theme === 'night' ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </header>
      <main className="page">
        <Suspense fallback={<p className="muted">Opening the page…</p>}>{page}</Suspense>
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <p>Runs in your browser. Your games are not uploaded.</p>
          <a href={href('about')}>How it works</a>
          <a href={reportHref}>Report a bug</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source code
          </a>
        </div>
      </footer>
    </div>
  );
}
