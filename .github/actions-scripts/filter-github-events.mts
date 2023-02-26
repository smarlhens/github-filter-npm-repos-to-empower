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
  octokitBot,
  retrievePackageJsonFilesAndWorkflows,
} from '../../src/index.mjs';

const main = async (): Promise<void> => {
  debug('Start main function');

  const ownerType = getOwnerType();
  const [repositories, botUser, events] = await Promise.all([
    getRepositories(),
    octokitBot.users.getAuthenticated(),
    octokit.paginate('GET /events', { per_page: 100 }),
  ]);
  debug(`${events.length} events received`);

  const pushAndPublicEvents = Array.from(
    new Set(
      events.filter(event => event.type === 'PushEvent' || event.type === 'PublicEvent').map(event => event.repo.name),
    ),
  ).map(name => events.find(event => event.repo.name === name)!);

  debug(`${pushAndPublicEvents.length} distinct repositories from push|public events`);

  const eventRepositories = await Promise.all(
    pushAndPublicEvents.map(async event => {
      const [owner, repoName] = event.repo.name.split('/');
      return octokit.repos
        .get({
          owner,
          repo: repoName,
        })
        .then(payload => payload.data as GitHubRepository)
        .catch(() => undefined);
    }),
  );

  const filterUndefinedRepo = (repo: GitHubRepository | undefined): repo is GitHubRepository => !!repo;

  const eventRepositoriesDefined = eventRepositories.filter(filterUndefinedRepo);
  debug(`${eventRepositoriesDefined.length} repositories defined`);

  const eventRepositoriesFilterByOwner = eventRepositoriesDefined.filter(
    repo => !ownerType || (ownerType && isOwnerOfType({ repo, type: ownerType })),
  );
  debug(`${eventRepositoriesFilterByOwner.length} repositories filtered by owner type`);

  const eventRepositoriesFilterStarsAndState = eventRepositoriesFilterByOwner.filter(
    isNotArchivedAndHaveAtLeastTenStars,
  );
  debug(`${eventRepositoriesFilterStarsAndState.length} repositories are not archived and have more than 10 stars`);

  const contexts: Context[] = (
    await Promise.all(
      eventRepositoriesFilterStarsAndState.map(repo =>
        retrievePackageJsonFilesAndWorkflows({ repo, user: botUser.data }),
      ),
    )
  ).filter(filterOpinionatedRepoToAnalyse);
  debug(`${contexts.length} repos filtered on package.json, package-lock.json, stars & CI job on pull requests`);

  if (contexts.length > 0) {
    debug(
      contexts
        .map(contextToOutput)
        .map(ctx => JSON.stringify(ctx))
        .join(', '),
    );
  }

  const reposToFork = contexts.filter(ctx => areDependenciesPinnedAndEnginesSet({ ctx, repositories }));

  debug(`${reposToFork.length} repos to fork`);

  setOutput('repos', reposToFork.map(contextToOutput));

  debug('End main function');
};

await main();
