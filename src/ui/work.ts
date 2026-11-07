import type { Contact, Job, Profile, WorkHistory } from '../contract'
import { h } from './dom'

// The work history as semantic HTML. The work view shows it over the dimmed
// hall and drives its timeline from the scroll (workmotion.ts); the no-GPU
// fallback reuses it as is, fully shown. `base` is the heading level of the
// page title, so the outline stays correct in both places.

type Level = 1 | 2 | 3 | 4 | 5 | 6
const heading = (level: number) => `h${Math.min(6, Math.max(1, level)) as Level}` as const

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** 'may 2025' → months since year 0. 'present' → this month. */
function monthOf(s: string, now = new Date()): number {
  if (/present|now/i.test(s)) return now.getFullYear() * 12 + now.getMonth()
  const [mon = '', yr = ''] = s.trim().toLowerCase().split(/\s+/)
  return Number(yr) * 12 + Math.max(0, MONTHS.indexOf(mon.slice(0, 3)))
}

/** Months in a role, counting both ends. */
const monthsIn = (job: Job) => monthOf(job.to) - monthOf(job.from) + 1

/** '1 yr 7 mos', '4 yrs 1 mo', '7 mos'. */
function span(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', m ? `${m} mo${m > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ')
}

const yearOf = (s: string) => (/present|now/i.test(s) ? 'now' : (s.trim().split(/\s+/)[1] ?? s))

/** Facts the page leads with, all derived from the data. */
function facts(work: WorkHistory) {
  const jobs = work.jobs
  const first = Math.min(...jobs.map((j) => monthOf(j.from)))
  const years = Math.floor((monthOf('present') - first) / 12)
  const companies = new Set(jobs.map((j) => j.company.toLowerCase())).size
  const remote = jobs.filter((j) => /remote/i.test(j.where))
  const remoteSince = remote.length ? Math.floor(Math.min(...remote.map((j) => monthOf(j.from))) / 12) : null
  const longest = jobs.reduce((a, b) => (monthsIn(b) > monthsIn(a) ? b : a))
  const now = jobs.find((j) => /present|now/i.test(j.to)) ?? null
  return {
    years: years >= 10 ? `${Math.floor(years / 5) * 5}+` : String(years),
    companies,
    remoteSince,
    longest,
    longestYears: Math.floor(monthsIn(longest) / 12),
    now,
  }
}

/** GitHub, LinkedIn, email and the CV, as a row of links. */
export function contactLinks(contact: Contact, opts: { fullEmail?: boolean; noEmail?: boolean } = {}): HTMLElement {
  const sep = () => h('span', { class: 'c-sep', text: ' · ', attrs: { 'aria-hidden': 'true' } })
  const out = (label: string, href: string, aria: string) =>
    h(
      'a',
      { class: 'c-link', attrs: { href, target: '_blank', rel: 'noopener', 'aria-label': aria } },
      label,
      h('span', { class: 'c-arr', text: ' ↗', attrs: { 'aria-hidden': 'true' } }),
    )
  const email = h('a', { class: 'c-link', attrs: { href: `mailto:${contact.email}` } }, opts.fullEmail ? contact.email : 'email')
  if (!opts.fullEmail) email.setAttribute('aria-label', `email ${contact.email}`)
  const cv = h(
    'a',
    { class: 'c-link', attrs: { href: contact.cv, download: 'Rashed-Parvez-CV.pdf', 'aria-label': 'download my cv, pdf' } },
    'cv',
    h('span', { class: 'c-arr', text: ' ↓', attrs: { 'aria-hidden': 'true' } }),
  )
  return h(
    'p',
    { class: 'contact' },
    out('github', contact.github, 'github, opens in a new tab'),
    sep(),
    out('linkedin', contact.linkedin, 'linkedin, opens in a new tab'),
    ...(opts.noEmail ? [] : [sep(), email]),
    sep(),
    cv,
  )
}

function renderJob(job: Job, level: number, current: boolean): HTMLElement {
  const H = heading(level)
  const Hp = heading(level + 1)
  const points = (items: string[]) => h('ul', { class: 'job-points' }, ...items.map((t) => h('li', { text: t })))
  const months = monthsIn(job)
  const highs = job.highlights?.length
    ? h(
        'dl',
        { class: 'job-highs' },
        ...job.highlights.map((x) => h('div', { class: 'job-high' }, h('dt', { text: x.label }), h('dd', { text: x.value }))),
      )
    : null
  return h(
    'li',
    { class: current ? 'job job--now' : 'job' },
    h(
      'div',
      { class: 'job-rail' },
      h('p', { class: 'job-year', text: yearOf(job.from) }),
      h('p', { class: 'job-range', text: `${job.from} → ${job.to}` }),
      h('p', { class: 'job-span', text: span(months) }),
    ),
    h('span', { class: 'job-node', attrs: { 'aria-hidden': 'true' } }),
    h(
      'div',
      { class: 'job-body' },
      h(
        H,
        { class: 'job-company' },
        job.company,
        current ? h('span', { class: 'job-now', text: '● now', attrs: { 'aria-label': ', current role' } }) : null,
      ),
      h('p', { class: 'job-role' }, h('span', { class: 'job-title', text: job.role }), h('span', { text: ` · ${job.where}` })),
      job.note ? h('p', { class: 'job-note' }, h('span', { class: 'job-note-mark', text: '↳ ', attrs: { 'aria-hidden': 'true' } }), job.note) : null,
      highs,
      job.points.length ? points(job.points) : null,
      ...(job.parts ?? []).flatMap((part) => [h(Hp, { class: 'job-part', text: part.title }), points(part.points)]),
      h('ul', { class: 'tags', attrs: { 'aria-label': 'stack' } }, ...job.stack.map((s) => h('li', { text: s }))),
    ),
  )
}

/** A labelled block on the timeline's grid: label in the rail, content beside it. */
function block(level: number, label: string, cls: string, ...content: Array<Node | null>): HTMLElement {
  return h(
    'section',
    { class: `w-sec ${cls}` },
    h(heading(level), { class: 'w-label', text: label }),
    h('div', { class: 'w-sec-body' }, ...content),
  )
}

/**
 * The work history. `base` is the level of the title heading; jobs and
 * sections sit one level below it.
 */
export function renderWork(work: WorkHistory, profile: Profile, base: number, titleId?: string): HTMLElement[] {
  const f = facts(work)
  const title = h(
    heading(base),
    { class: 'w-title' },
    h('span', { class: 'sr-only', text: 'work history: ' }),
    h('span', { class: 'w-big', text: `${f.years} years` }),
    h('span', { class: 'w-big w-big-2', text: 'of frontend.' }),
  )
  if (titleId) title.id = titleId

  const stat = (value: string, label: string, cls = '') =>
    h('div', { class: `w-stat ${cls}`.trim() }, h('dt', { text: label }), h('dd', { text: value }))
  const stats = h(
    'dl',
    { class: 'w-stats' },
    stat(String(f.companies), 'companies, newest first'),
    f.remoteSince ? stat(String(f.remoteSince), 'remote since') : null,
    stat(`${f.longestYears} yrs`, `longest stay · ${f.longest.company.toLowerCase()}`),
    f.now ? stat('● now', `${f.now.company.toLowerCase()}, since ${f.now.from}`, 'w-stat--now') : null,
  )

  const header = h(
    'header',
    { class: 'w-head' },
    h('p', { class: 'w-kicker' }, h('span', { class: 'p-prompt', text: '$ ' }), 'cat ~/work'),
    title,
    h('p', {
      class: 'w-sub',
      text: `${profile.role.split('·')[0]!.trim()}${f.remoteSince ? `, on remote teams in the us and europe since ${f.remoteSince}` : ''}. newest first.`,
    }),
    stats,
  )

  const jobs = h(
    'ol',
    { class: 'jobs', attrs: { 'aria-label': 'roles, newest first' } },
    ...work.jobs.map((job) => renderJob(job, base + 1, job === f.now)),
  )

  const education = block(
    base + 1,
    'education',
    'w-sec--edu',
    ...work.education.flatMap((e) => [h('p', { class: 'w-edu', text: e.degree }), h('p', { class: 'w-meta', text: `${e.school} · ${e.years}` })]),
  )

  const earlier = block(
    base + 1,
    'earlier work',
    'w-sec--earlier',
    h(
      'ul',
      { class: 'w-rows' },
      ...work.earlier.map((p) =>
        h(
          'li',
          null,
          h(
            'a',
            { class: 'w-row', attrs: { href: p.url, target: '_blank', rel: 'noopener', 'aria-label': `${p.name}, ${p.line} opens in a new tab` } },
            h('span', { class: 'w-row-name', text: p.name }),
            h('span', { class: 'w-row-line', text: p.line }),
            h('span', { class: 'w-row-host', text: `${p.url.replace(/^https?:\/\/(www\.)?/, '')} ↗` }),
          ),
        ),
      ),
    ),
  )

  const skills = block(
    base + 1,
    'skills',
    'w-sec--skills',
    h(
      'dl',
      { class: 'w-skillgrid' },
      ...work.skills.map((g) =>
        h('div', { class: 'w-skill' }, h('dt', { text: g.group }), h('dd', null, h('ul', { class: 'w-chips' }, ...g.items.map((s) => h('li', { text: s }))))),
      ),
    ),
  )

  const contact = block(
    base + 1,
    'contact',
    'w-sec--contact',
    h('p', { class: 'w-kicker' }, h('span', { class: 'p-prompt', text: '$ ' }), 'mail rashed'),
    h('a', { class: 'w-mail', text: profile.contact.email, attrs: { href: `mailto:${profile.contact.email}` } }),
    contactLinks(profile.contact, { noEmail: true }),
    h('p', { class: 'w-meta w-place', text: profile.place }),
  )

  return [header, jobs, education, earlier, skills, contact]
}
