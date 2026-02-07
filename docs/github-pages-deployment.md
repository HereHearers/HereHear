# GitHub Pages Auto-Deployment

This project uses a GitHub Actions workflow to automatically build and deploy the app to GitHub Pages on every push.

## How It Works

1. A push to **any branch** triggers the workflow defined in `.github/workflows/deploy.yml`
2. The workflow:
   - Checks out the repository
   - Installs Node.js 20 and runs `npm install` in the `gpsound/` directory
   - Builds the app with `npm run build`, setting `BASE_PATH` to `/<repo-name>/build/<branch-name>/`
   - Deploys the build output (`gpsound/dist`) to the `gh-pages` branch under `build/<branch-name>/`
3. GitHub Pages serves the `gh-pages` branch, making each branch deployment available at its own URL

## Accessing Deployed Sites

Each branch gets its own URL:

```
https://<org-or-user>.github.io/<repo-name>/build/<branch-name>/
```

For example:

```
https://herehearers.github.io/HereHear/build/feature/timelineSyncNTP/
https://herehearers.github.io/HereHear/build/main/
```

## Required GitHub Settings

### 1. Enable GitHub Pages

1. Go to your repository on GitHub
2. Navigate to **Settings > Pages**
3. Under **Source**, select **Deploy from a branch**
4. Set the branch to **`gh-pages`** and the folder to **`/ (root)`**
5. Click **Save**

### 2. Workflow Permissions

The workflow requires these permissions (already configured in `deploy.yml`):

- `contents: write` — to push build output to the `gh-pages` branch
- `pages: write` — to deploy to GitHub Pages
- `id-token: write` — for authentication

If the workflow fails with a permissions error, go to **Settings > Actions > General > Workflow permissions** and ensure **Read and write permissions** is selected.

## Key Configuration Details

| Setting | Value | Purpose |
|---|---|---|
| `publish_dir` | `./gpsound/dist` | The Vite build output directory |
| `destination_dir` | `build/<branch-name>` | Subdirectory on `gh-pages` for this branch |
| `keep_files` | `true` | Preserves other branch deployments |
| `BASE_PATH` | `/<repo>/build/<branch>/` | Ensures assets load from the correct URL path |

## Vite Configuration

The `BASE_PATH` environment variable is read in `gpsound/vite.config.ts`:

```ts
base: process.env.BASE_PATH || '/'
```

This ensures asset paths (JS, CSS, images) are correct for the deployed URL. Locally, it defaults to `/`.
