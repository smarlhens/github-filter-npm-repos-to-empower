import { debug, setOutput } from '@actions/core';

import {
  areDependenciesPinnedAndEnginesSet,
  Context,
  contextToOutput,
  filterOpinionatedRepoToAnalyse,
  getRepositories,
  isNotArchivedAndHaveAtLeastTenStars,
  octokit,
  retrievePackageJsonFilesAndWorkflows,
} from '../../src/index.mjs';

const main = async (): Promise<void> => {
  debug('Start main function');

  const [repositories, user, repos] = await Promise.all([
    getRepositories(),
    octokit.users.getAuthenticated(),
    octokit.paginate('GET /user/repos', { per_page: 100, visibility: 'all' }),
  ]);
  debug(`${repos.length} repos received`);

  const filteredRepos: Context[] = (
    await Promise.all(
      repos
        .filter(isNotArchivedAndHaveAtLeastTenStars)
        .map(repo => retrievePackageJsonFilesAndWorkflows({ repo, user: user.data })),
    )
  ).filter(filterOpinionatedRepoToAnalyse);

  debug(`${filteredRepos.length} repos filtered on package.json, package-lock.json, stars & CI job on pull requests`);

  const reposToFork = filteredRepos.filter(ctx => areDependenciesPinnedAndEnginesSet({ ctx, repositories }));

  debug(`${reposToFork.length} repos to fork`);

  setOutput('repos', reposToFork.map(contextToOutput));

  debug('End main function');
};

await main();
