# Release process

## Version alignment

- The root package and extension packages share a single semantic version.
- Extension `package.json` files must be updated to match the root version before a tag is cut.

## Pre-release checklist

1. Ensure `main` passes CI (`npm run check`, `npm test`, `npm audit --omit=dev --audit-level=high`).
2. Update `CHANGELOG.md` with the release date and any migration notes.
3. Verify `SECURITY.md` supported-version table is current.
4. Bump the root and extension `package.json` versions together.
5. Run a manual Matrix homeserver smoke test if the Matrix extension changed:
   - invite/join,
   - inbound/outbound rich text,
   - attachment download,
   - reconnect,
   - restart without replay.

## Tag and publish

```bash
VERSION=$(node -p "require('./package.json').version")
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"
```

GitHub Actions will build and verify the tag. Publish to npm after the workflow succeeds:

```bash
npm publish --provenance
```

## Rollback

If a release is broken, mark it deprecated on npm and fast-follow with a patch release. Do not unpublish.
