# Contributing

Git is the only source authority for this project.

## Run the project

1. Run `yarn install --frozen-lockfile`.
2. Run `yarn dev`.

## Submit a change

1. Fetch GitHub and switch to `preview`.
2. Pull with `git pull --ff-only origin preview`.
3. Create a feature branch from `preview`.
4. Commit and push the feature branch.
5. Open a pull request targeting `preview`.

Feature branches stay isolated until someone selects one in Site Builder. Selecting a branch preserves the prior branch in Git, then materializes the selected commit as the shared working copy. Signed webhooks keep selected and previously selected branches current. The `main` branch is a read-only release candidate in Site Builder. A branch switch, merge, or push never publishes the deployed App.

Do not force-push `preview` or `main`. Keep exactly one lockfile, never commit `node_modules`, and keep credentials out of the repository. Do not use Git submodules or symbolic links. Git-backed Site Builder projects currently use hosted URLs for binary media; do not add runtime images, audio, or video under `assets/`, `public/`, or `src/assets/`.
