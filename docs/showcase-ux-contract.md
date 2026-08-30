# Showcase UX contract

## User and job

The public brand is `Abalone`, with `byabalone.com` selected as its custom domain. The name reflects software that stays close to a customer's real work without implying physical residency. The public promise is broader than recurring-work automation: learn a customer's industry, people, rules, exceptions, and existing tools, then remotely shape and validate software around that real work. Customer-facing copy does not lead with `FDE`, `상주`, `nohdol auto`, `자동화`, or implementation terminology. It describes close remote collaboration in plain Korean without implying an employee placement, instant build, or unlimited continuing support. Existing product proper names and operational identifiers remain unchanged when renaming them would break truthful product or installation continuity.

The brand mark is a font-independent geometric lowercase `a`: its wide bowl suggests an abalone shell and its grounded lower edge represents close contact. It uses the existing accent and contrast colors without gradients or literal seafood imagery. The same SVG source appears in the header and footer and produces the favicon, legacy ICO, Apple touch icon, and 192/512-pixel web app icons.

The primary visitor either wants a program shaped around their domain or has been told about an existing desktop program. They should answer these questions without reading a technical campaign page:

1. Will the service first understand how our work actually operates?
2. How does remote discovery become a small, testable program and a controlled rollout?
3. What do the existing program examples do, and are their recordings verified external workflows or disclosed local demonstrations?
4. Does an example provide a downloadable installer or installation information only?

The home page first explains the service sequence as `업무 이해 -> 작은 검증 -> 적용과 개선`, states that collaboration is remote, and offers both `제작 사례 보기` and `프로그램 상담 시작`. The catalog remains the truthful evidence surface: a detail route leads with its reviewed workflow recording, and an install route leads with the operating-system choice and installer-code control. Verified products may authorize a download; demo-only programs may say `설치 페이지 제공` while the same surface clearly states that the installer and code are not currently provided, keeps the control disabled, and attempts no request.

The catalog also explains the day-to-day program experience in plain Korean. It promises to learn domain language before choosing a solution, validate the highest-value workflow in a small scope, and improve within an agreed remote delivery scope using observed results. Programs still need a clear screen, a natural order of use, visible progress, and understandable recovery guidance without asking visitors to understand development terminology.

The header exposes `문의하기` on every route. The dialog first explains the outcome in non-technical Korean, then separates required inquiry/privacy consent from optional marketing consent. Email input leads to a six-digit verification step, not directly to chat. A verified visitor resumes the newest incomplete inquiry, sees canonical server history, can add allowlisted private files, receives two-to-four-option choice cards when useful, and can always answer in their own words.

When the assistant considers the brief ready, the visitor can expand and review the generated specification. Completion remains disabled until the visitor explicitly checks that they reviewed it. Completion copy promises a prompt email follow-up without claiming a guaranteed deadline. Logout revokes only the session; `이 문의 삭제` removes the selected conversation and attachments after a destructive confirmation.

## Visual direction

- Feel like a calm product directory and distribution guide: operational, readable, and quietly polished.
- Map the shared `nohdol-clean` profile to this public site: light neutral canvas, white surface, inset controls, one low-saturation blue accent, and semantic status colors only.
- Use a 4px spacing grid, 6px controls, 8px grouped surfaces, and 10px floating or emphasized surfaces.
- Use borders and small surface shifts for depth. Ordinary content has no drop shadow.
- Use the native Korean-capable font stack and a compact type scale. Weight and tone create hierarchy before size.
- The signature structure is the public-to-protected delivery path: public workflow evidence, program-specific installer authorization, and an explicit safe-stop boundary.

The site does not use gradients, glows, glass/blur, decorative background textures, rotated mockups, oversized hero type, or ambient animation. Cards exist only for an independently selectable program, the workflow recording, and the installation form.

## Responsive and accessibility contract

- Minimum verification viewport: `360 x 800`.
- Nominal verification viewport: `1440 x 1000`.
- The site remains responsive because it is a public web surface; the desktop-only application-renderer constraint does not apply to this repository.
- All routes prevent horizontal overflow, preserve readable long Korean copy, and expose visible `:focus-visible` treatment.
- Native links, buttons, labels, select, and password input remain keyboard operable.
- The inquiry dialog uses a labeled native dialog, keyboard-operable close and choice controls, an `aria-live` message region, announced busy/error/success states, and visible focus treatment. At mobile width it becomes a full-viewport surface without hiding the inquiry action.
- The installation form keeps the code after neither success nor failure, blocks duplicate submission while authorizing, restores focus to the code field after recoverable failure, and announces status changes.
- Reduced-motion preferences remove smooth scrolling and non-essential movement.

## State and safety contract

- Catalog: loading, populated, empty, and load-failure states remain visible.
- Inquiry: signed-out, requesting-code, code-entry, authenticated-loading, empty/resumed chat, uploading, streaming, retryable generation failure, review-ready, completed, and deletion states remain distinct in text rather than color alone.
- Detail: each reviewed GIF and caption identifies either the verified program-to-site flow or the deterministic demo-data boundary. Public copy does not use `UI 콘셉트`, `UI 프로토타입`, temporary-portfolio, or removal-plan language.
- Install: ready, authorizing, disabled-until-endpoint, success, and recoverable failure states remain distinct in text, not color alone.
- A disabled install preview may show the same route, platform selector, and code field as a distributed product, but it has `authEndpoint: null`, a disabled submit button, an early request guard, and an explicit not-yet-available message.
- The public site never contains or validates raw installer codes, product keys, verifiers, private object URLs, administrator controls, or direct installer URLs.
- Visual changes must not change route generation, platform fallback, the `/authorize` request shape, code clearing, or the 60-second server-side delivery boundary.
