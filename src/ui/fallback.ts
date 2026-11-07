import type { Profile, Project, WorkHistory } from '../contract'
import { h } from './dom'
import { contactLinks, renderWork } from './work'

/** Plain, readable page for browsers with no GPU path: about, projects, work, contact. */
export function renderFallback(projects: Project[], profile: Profile, work: WorkHistory, reason: string): HTMLElement {
  return h(
    'main',
    { class: 'fallback' },
    h(
      'header',
      { class: 'fb-head' },
      h('h1', { class: 'ident-name', text: profile.name }),
      h('p', { class: 'ident-role', text: profile.role }),
      h('p', { class: 'ident-role', text: profile.place }),
    ),
    h('div', { class: 'fb-hello' }, h('p', { class: 'fb-hi', text: profile.hello }), ...profile.lines.map((t) => h('p', { class: 'fb-line', text: t }))),
    contactLinks(profile.contact),
    h('p', {
      class: 'fb-note',
      text: 'the 3d harbor needs webgpu or webgl2, and this browser has neither. here is everything as text.',
    }),
    reason ? h('p', { class: 'fb-reason', text: reason }) : null,
    h('h2', { class: 'fb-h', text: 'projects' }),
    h(
      'ol',
      { class: 'fb-list' },
      ...projects.map((p, i) =>
        h(
          'li',
          { attrs: { style: `--accent: ${p.accent}` } },
          h('span', { class: 'fb-n', text: String(i + 1).padStart(2, '0') }),
          h(
            'div',
            null,
            h('a', { class: 'fb-name', text: p.name, attrs: { href: p.url, target: '_blank', rel: 'noopener' } }),
            h('p', { class: 'fb-kind', text: `${p.kind} · ${p.year}${p.stars > 0 ? ` · ★ ${p.stars}` : ''}` }),
            h('p', { class: 'fb-line', text: p.line }),
          ),
        ),
      ),
    ),
    h('section', { class: 'fb-work', attrs: { 'aria-label': 'work history' } }, ...renderWork(work, profile, 2)),
  )
}
