import type { Profile, WorkHistory } from './contract'

// From my CV (Rashed Parvez_resume.pdf, 2026). Facts stay as the CV states
// them; wording is lowercased to match the rest of the site.

export const profile: Profile = {
  name: 'rashed parvez',
  role: 'frontend engineer · full-stack typescript · 10+ yrs',
  place: 'dhaka, bangladesh · remote, utc+6',
  hello: "hi, i'm rashed.",
  summary: 'frontend engineer, 10+ years in react and typescript, on remote teams in the us and europe.',
  lines: [
    "i'm a frontend engineer, 10+ years in, mostly react and typescript on remote teams in the us and europe.",
    'four of those years went to healthcare data platforms at iqvia, working on large react apps against rest apis. i go a layer down into node, prisma and mongodb when a feature needs it.',
    'lately most of my own time goes into effect-ts, mainly its error handling and concurrency model, and into tools for my own terminal and neovim.',
  ],
  contact: {
    github: 'https://github.com/rashedInt32',
    linkedin: 'https://www.linkedin.com/in/rashed-parvez',
    email: 'parvez08eee@gmail.com',
    cv: '/rashed-parvez-cv.pdf',
  },
}

export const work: WorkHistory = {
  jobs: [
    {
      role: 'software engineer',
      company: 'BauCheck',
      where: 'remote, contract',
      from: 'may 2025',
      to: 'present',
      points: [
        'rebuilt the frontend of a laravel app on react, vite and inertia. roughly 25 screens migrated.',
        'split a legacy codebase into feature modules so the team could work in parallel.',
        'wrote the rest layer between the new frontend and the existing backend services.',
      ],
      stack: ['React', 'Vite', 'Inertia.js', 'shadcn/ui', 'Node.js'],
      highlights: [{ value: '~25', label: 'screens migrated to react' }],
    },
    {
      role: 'frontend engineer',
      company: 'ManAI',
      where: 'remote',
      from: 'sep 2024',
      to: 'mar 2025',
      points: [
        'built the mvp frontend for a restaurant menu and ordering platform. shipped in 12 weeks.',
        'handled live menu updates and the ordering flow, including the state model for cart and order status.',
        'worked directly with the founder and designer on scope.',
      ],
      stack: ['React', 'Next.js', 'shadcn/ui', 'InstantDB'],
      highlights: [{ value: '12 wk', label: 'mvp to shipped' }],
    },
    {
      role: 'frontend engineer',
      company: 'Adeva',
      where: 'remote',
      from: 'may 2020',
      to: 'jun 2024',
      note: 'placed as a contract engineer with iqvia for most of this period.',
      points: [],
      parts: [
        {
          title: 'iqvia, healthcare and medical standards platforms',
          points: [
            "built and maintained react applications for ash datahub, the american society of hematology's research data platform.",
            'integrated fullcalendar for scheduling and echarts for the reporting dashboards.',
            'refactored api modules with redux toolkit, cutting load time from 6s to 2s.',
            'worked alongside backend engineers and designers on shared component work.',
          ],
        },
        {
          title: 'adeva, internal',
          points: ['moved the company marketing site off laravel onto next.js with ssr. organic traffic changed by 70% over 3 months.'],
        },
      ],
      stack: ['React', 'Vue.js', 'Next.js', 'TypeScript', 'Redux Toolkit', 'React Query', 'MUI', 'eCharts', 'FullCalendar'],
      highlights: [
        { value: '6s → 2s', label: 'load time, ash datahub' },
        { value: '70%', label: 'organic traffic change in 3 months' },
      ],
    },
    {
      role: 'react developer',
      company: 'Qoreboard',
      where: 'remote',
      from: 'may 2019',
      to: 'feb 2020',
      points: [
        'built an employee management dashboard for hr data tracking and reporting.',
        'wrote the shared component library the rest of the app was built on.',
        'connected the frontend to node and express services.',
      ],
      stack: ['React', 'Node.js', 'Express', 'Bootstrap'],
    },
    {
      role: 'frontend developer',
      company: 'WeAreDamage',
      where: 'remote',
      from: 'sep 2017',
      to: 'jan 2019',
      points: ['shipped 16+ client web and mobile projects on angular, ionic and wordpress.'],
      stack: ['Angular', 'Ionic', 'jQuery', 'WordPress'],
      highlights: [{ value: '16+', label: 'client projects shipped' }],
    },
    {
      role: 'frontend developer',
      company: 'RedQ',
      where: 'dhaka',
      from: 'jul 2015',
      to: 'aug 2017',
      points: ['built html, css and javascript templates sold on the envato marketplace.'],
      stack: ['JavaScript', 'jQuery', 'WordPress', 'Bootstrap'],
    },
  ],
  education: [
    {
      degree: 'bsc, electrical and electronics engineering',
      school: 'rajshahi university of engineering & technology (ruet)',
      years: '2009 to 2013',
    },
  ],
  earlier: [
    { name: 'Cirkle', line: 'social platform features in react.', url: 'https://cirkle.com' },
    { name: 'Eduly', line: 'ionic mobile app and landing page.', url: 'https://eduly.co.uk' },
    { name: 'English Cut', line: 'storefront ui for an e-commerce platform.', url: 'https://englishcut.com' },
  ],
  skills: [
    { group: 'frontend', items: ['React', 'Next.js', 'TypeScript', 'Effect-TS', 'JavaScript (ES6+)', 'HTML5', 'CSS3'] },
    { group: 'state & data', items: ['Redux Toolkit', 'React Query', 'REST APIs'] },
    { group: 'backend', items: ['Node.js', 'Express', 'Prisma', 'MongoDB'] },
    { group: 'ui', items: ['Tailwind CSS', 'shadcn/ui', 'MUI', 'Bootstrap', 'responsive layout'] },
    { group: 'performance & a11y', items: ['code splitting', 'memoization', 'SSR', 'WCAG', 'ARIA'] },
    { group: 'testing & tooling', items: ['Vitest', 'React Testing Library', 'Vite', 'Git', 'CI/CD'] },
  ],
}
