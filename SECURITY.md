# Security

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Report it privately through GitHub:
[Report a vulnerability](https://github.com/overweave/overweave/security/advisories/new) (the
repository's Security tab → Advisories). Say what is affected (package, version), how to reproduce it,
and what an attacker gains.

You will get an answer within a week. Once a fix is released, the advisory is published, crediting you
unless you ask not to be.

## Supported versions

overweave is 0.x: only the latest release gets fixes. Update to it before reporting, if you can.

## What is in scope

The published packages (`@overweave/core`, `@overweave/ui`, `@overweave/testkit`,
`@overweave/storybook`) and this repository's workflows. `@overweave/testkit` and
`@overweave/storybook` are development tools: an issue in them matters when it reaches what is built or
the machine it is built on.

## Verifying a package

Every release is published from this repository's release workflow, with provenance: `npm audit
signatures` in a project that installed it checks that each `@overweave` package was built here, from
the commit its tag names.
