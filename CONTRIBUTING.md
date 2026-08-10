# Contributing

## Development flow

1. Fork the repository and create a focused branch.
2. Keep account isolation and existing API contracts intact.
3. Add or update tests for behavioral changes.
4. Run the relevant frontend and backend checks.
5. Open a pull request with the problem, behavior change and verification evidence.

## Repository boundaries

- Never commit real API keys, production URLs, user messages, memory exports or database backups.
- Private storage exports must be written outside the repository; never attach their media or manifest to an Issue or pull request.
- Keep model-provider-specific behavior behind the existing provider interfaces.
- Do not make a production capability claim without an end-to-end test.
- Keep Android changes compatible with the Capacitor build.

## Useful commands

```bash
cd frontend
npm ci
npm test
npm run build
npm run lint

cd ../backend
npm ci
npm test
npm run check
```
