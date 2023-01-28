import { debug, setOutput } from '@actions/core';

import {
  areDependenciesPinnedAndEnginesSet,
  Context,
  contextToOutput,
  filterOpinionatedRepoToAnalyse,
  GitHubRepository,
  isNotArchivedAndHaveAtLeastTenStars,
  octokit,
  retrievePackageJsonFilesAndWorkflows,
} from '../../index.mjs';

const main = async (): Promise<void> => {
  debug('Start main function');

  const repos: GitHubRepository[] = await octokit.paginate('GET /user/repos', { per_page: 100, visibility: 'all' });
  debug(`${repos.length} repos received`);

  const currentUser = (await octokit.users.getAuthenticated()).data;
  const filteredRepos: Context[] = (
    await Promise.all(
      repos
        .filter(isNotArchivedAndHaveAtLeastTenStars)
        .map(repo => retrievePackageJsonFilesAndWorkflows({ repo, currentUser })),
    )
  ).filter(filterOpinionatedRepoToAnalyse);

  debug(`${filteredRepos.length} repos filtered on package.json, package-lock.json, stars & CI job on pull requests`);

  const reposToFork = filteredRepos.filter(areDependenciesPinnedAndEnginesSet);

  debug(`${reposToFork.length} repos to fork`);

  setOutput('repos', reposToFork.map(contextToOutput));

  debug('End main function');
};

await main();
