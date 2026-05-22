# Alpha Rules

Status: this is a current alpha-direction document.

The project is now moving through the first alpha architecture.

Alpha work is a clean rewrite into the right package shape, not a migration of
earlier experimental code. New alpha packages must not import old implementation
modules, copy service structure wholesale, or preserve historical habits just
because they exist.

The approach is:

```txt
1. Create the replacement with the right boundary.
2. Test it thoroughly.
3. Integrate it through a narrow adapter or teaching example.
4. Remove superseded code only after the alpha replacement is real.
```

Core `skykit` should become a slim teaching toolkit and composition layer over
focused `@found-in-space/*` packages. Do not add new reusable capabilities to
core `skykit` by default. Put them in a package with a clear responsibility and
make `skykit` depend on that package when it needs the capability.

Package boundaries should follow the learning architecture in
[`package-learning-architecture.md`](./package-learning-architecture.md):

```txt
generic lifecycle mechanics
  -> domain-specific product interpretation
  -> renderer or analysis adapters
  -> slim skykit composition examples
```

This applies beyond universe-data packages. If a feature is useful to Found in
Space but not specific to stars, galaxies, solar-system bodies, H-alpha, dust,
or another space-data product, it should still be split out when it can stand
alone. `touch-os` is the model for this: it is a Found in Space project that
`skykit` can use for interactive surfaces, but it is not itself a SkyKit module.
