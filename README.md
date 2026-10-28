# AsteAI demo package

- `index.html` is the standalone deployable demo.
- `src/` contains editable reference splits extracted from the same source. Deploy `index.html`, not the `src/` files.
- `_headers` sets a few basic response headers.

## Cloudflare Pages
Create a Pages project from this folder/repository. Use no build command and set the build output directory to `.`. The root must contain `index.html`.

## Demo-only limitations
This is a prototype reconstructed from the supplied source-code PDF. It uses browser `localStorage` and seeded sample data, not a production backend. Voice input depends on browser support. Live interpretation depends on the original Claude `sample` capability and may not be available on a normal static host. Do not enter real candidate data, credentials, or payment details. Test the primary demo flows in a fresh/incognito browser before presenting.
