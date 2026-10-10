/** One place for the names and addresses the app shows. */
export const APP_NAME = 'Postmortem';
export const REPO_URL = 'https://github.com/harsha2805/chess';
/** Bug reports are posted here and emailed by the server. See public/api/report.php. */
export const REPORT_ENDPOINT = 'api/report.php';
export const APP_VERSION: string = __APP_VERSION__;

export const SAMPLE_PGN = `[Event "A Night at the Opera"]
[Site "Paris"]
[Date "1858.11.02"]
[White "Paul Morphy"]
[Black "Duke Karl and Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

/**
 * True in the build made for a sandboxed preview page, which cannot reach other sites.
 * Username import and bug report sending are switched off there, and routes are kept in memory.
 */
export const PREVIEW: boolean = import.meta.env.VITE_PREVIEW === '1';
