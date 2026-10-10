import { useEffect } from 'react';
import { APP_NAME, REPO_URL } from './config';
import { About } from './ui/About';
import { Home } from './ui/Home';
import { Insights } from './ui/Insights';
import { Report } from './ui/Report';
import { Review } from './ui/Review';
import { href, useRoute } from './ui/router';

export function App() {
  const route = useRoute();
  const [section, a, b] = route;

  let page;
  let title = `${APP_NAME}: free chess game review`;
  if (section === 'game' && a) {
    page = <Review id={a} startPly={b ? Number(b) || 0 : undefined} />;
    title = `Review | ${APP_NAME}`;
  } else if (section === 'insights') {
    page = <Insights />;
    title = `Insights | ${APP_NAME}`;
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
          <a className="brand" href={href()}>
            {APP_NAME}
            <span className="brand-mark" aria-hidden="true">
              !!
            </span>
          </a>
          <nav className="nav" aria-label="Main">
            <a href={href()} aria-current={!section || section === 'game' ? 'page' : undefined}>
              Games
            </a>
            <a href={href('insights')} aria-current={section === 'insights' ? 'page' : undefined}>
              Insights
            </a>
          </nav>
        </div>
      </header>
      <main className="page">{page}</main>
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
