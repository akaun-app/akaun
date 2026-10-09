import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

// The site deploys to the separate `<org>/<org>.github.io` repo, the org's root Pages
// site, so it is served at `/` both there and on localhost. CI passes the org as
// DOCS_ORG (from `github.repository_owner`), so a renamed organization needs no change
// here as long as the docs repo is renamed to match. GitHub does not redirect Pages
// sites, so the public URL does change with it.
const org = process.env.DOCS_ORG ?? 'getakaun';

const config: Config = {
  title: 'Akaun',
  tagline: 'A self-hosted expense, income, and reimbursement tracker for small teams and freelancers.',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  url: `https://${org}.github.io`,
  baseUrl: '/',
  trailingSlash: false,

  organizationName: org,
  projectName: `${org}.github.io`,
  deploymentBranch: 'gh-pages',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        // Docs-only site: the docs are the home page, with no separate landing page.
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          editUrl: `https://github.com/${org}/akaun/tree/main/docs/`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Akaun',
      logo: {
        alt: 'Akaun',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: `https://github.com/${org}/akaun`,
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [{label: 'Introduction', to: '/'}],
        },
        {
          title: 'More',
          items: [{label: 'GitHub', href: `https://github.com/${org}/akaun`}],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Akaun. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
