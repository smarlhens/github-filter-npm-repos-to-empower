import { debug, setOutput } from '@actions/core';

import {
  areDependenciesPinnedAndEnginesSet,
  Context,
  contextToOutput,
  filterOpinionatedRepoToAnalyse,
  getOwnerType,
  getRepositories,
  GitHubRepository,
  isNotArchivedAndHaveAtLeastTenStars,
  isOwnerOfType,
  octokit,
  retrievePackageJsonFilesAndWorkflows,
} from '../../index.mjs';

const main = async (): Promise<void> => {
  debug('Start main function');

  const ownerType = getOwnerType();
  const [repositories, currentUser, events] = await Promise.all([
    getRepositories(),
    octokit.users.getAuthenticated(),
    octokit.paginate('GET /events', { per_page: 100 }),
  ]);
  debug(`${events.length} events received`);

  const contexts: Context[] = (
    await Promise.all(
      Array.from(
        new Set(
          events
            .filter(event => event.type === 'PushEvent' || event.type === 'PublicEvent')
            .map(event => event.repo.name),
        ),
      )
        .map(name => events.find(event => event.repo.name === name)!)
        .map(async event => {
          const [owner, repoName] = event.repo.name.split('/');
          return octokit.repos
            .get({
              owner,
              repo: repoName,
            })
            .then(payload => payload.data as GitHubRepository)
            .catch(() => undefined);
        }),
    ).then<Context[]>(payload => {
      const filterUndefinedRepo = (repo: GitHubRepository | undefined): repo is GitHubRepository => !!repo;
      return Promise.all(
        payload
          .filter(filterUndefinedRepo)
          .filter(repo => !ownerType || (ownerType && isOwnerOfType({ repo, type: ownerType })))
          .filter(isNotArchivedAndHaveAtLeastTenStars)
          .map(repo => retrievePackageJsonFilesAndWorkflows({ repo, currentUser: currentUser.data })),
      );
    })
  ).filter(filterOpinionatedRepoToAnalyse);

  debug(`${contexts.length} repos filtered on package.json, package-lock.json, stars & CI job on pull requests`);
  debug(contexts.map(contextToOutput).join(', '));

  const reposToFork = contexts.filter(ctx => areDependenciesPinnedAndEnginesSet({ ctx, repositories }));

  debug(`${reposToFork.length} repos to fork`);

  setOutput('repos', reposToFork.map(contextToOutput));

  debug('End main function');
};

await main();
