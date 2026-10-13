import { Suspense, lazy, useEffect } from 'react';
import { APP_NAME, PREVIEW, REPO_URL } from './config';
import { useAccount } from './lib/account';
import { Home } from './ui/Home';
import { Review } from './ui/Review';
import { IconMoon, IconSun, IconUser } from './ui/icons';
import { href, useRoute } from './ui/router';
import { useTheme } from './ui/theme';

// The games list and the review are where visits start; the other pages load when first opened.
const Insights = lazy(() => import('./ui/Insights').then((m) => ({ default: m.Insights })));
const Dictionary = lazy(() => import('./ui/Dictionary').then((m) => ({ default: m.Dictionary })));
const About = lazy(() => import('./ui/About').then((m) => ({ default: m.About })));
const Report = lazy(() => import('./ui/Report').then((m) => ({ default: m.Report })));
const SignIn = lazy(() => import('./ui/Account').then((m) => ({ default: m.SignIn })));
const Forgot = lazy(() => import('./ui/Account').then((m) => ({ default: m.Forgot })));
const Reset = lazy(() => import('./ui/Account').then((m) => ({ default: m.Reset })));
const AccountPage = lazy(() => import('./ui/Account').then((m) => ({ default: m.AccountPage })));
const Admin = lazy(() => import('./ui/Admin').then((m) => ({ default: m.Admin })));

export function App() {
  const route = useRoute();
  const [section, a, b] = route;
  const [theme, toggleTheme] = useTheme();
  const accountStatus = useAccount((s) => s.status);
  const email = useAccount((s) => s.user?.email);
  const donateUrl = useAccount((s) => s.donateUrl);

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
  } else if (section === 'signin' || section === 'signup') {
    page = <SignIn create={section === 'signup'} problem={a} />;
    title = `${section === 'signup' ? 'Create an account' : 'Sign in'} | ${APP_NAME}`;
  } else if (section === 'forgot') {
    page = <Forgot />;
    title = `Set a new password | ${APP_NAME}`;
  } else if (section === 'reset' && a && b) {
    page = <Reset token={a} email={b} />;
    title = `Set a new password | ${APP_NAME}`;
  } else if (section === 'admin') {
    page = <Admin section={a} />;
    title = `Admin | ${APP_NAME}`;
  } else if (section === 'account') {
    page = <AccountPage notice={a} />;
    title = `Your account | ${APP_NAME}`;
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
          {accountStatus === 'signed-in' ? (
            <a
              className="account-btn"
              href={href('account')}
              aria-current={section === 'account' ? 'page' : undefined}
              aria-label={`Your account (${email})`}
              title={email}
            >
              <span aria-hidden="true">{email?.[0]?.toUpperCase()}</span>
            </a>
          ) : accountStatus === 'signed-out' ? (
            <a className="account-btn" href={href('signin')} aria-current={section === 'signin' || section === 'signup' ? 'page' : undefined} aria-label="Sign in" title="Sign in">
              <IconUser />
            </a>
          ) : null}
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
          <p>
            {accountStatus === 'signed-in'
              ? 'Reviews run in your browser. Your games are saved to your account.'
              : accountStatus === 'unavailable'
                ? 'Runs in your browser. Your games are not uploaded.'
                : 'Runs in your browser. Your games stay here unless you create an account.'}
          </p>
          <a href={href('about')}>How it works</a>
          {/* Real pages, outside the app, that search engines can read. The preview build has none. */}
          {!PREVIEW && <a href="/openings/">Openings A to Z</a>}
          {!PREVIEW && <a href="/guide/">Guides</a>}
          <a href={reportHref}>Report a bug</a>
          {donateUrl && (
            <a href={donateUrl} target="_blank" rel="noreferrer">
              Support {APP_NAME}
            </a>
          )}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            Source code
          </a>
        </div>
      </footer>
    </div>
  );
}
