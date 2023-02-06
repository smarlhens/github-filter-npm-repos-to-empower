import { debug, setOutput } from '@actions/core';
import type { components } from '@octokit/openapi-types';

import {
  areDependenciesPinnedAndEnginesSet,
  Context,
  contextToOutput,
  filterOpinionatedRepoToAnalyse,
  getOwnerType,
  GitHubRepository,
  isNotArchivedAndHaveAtLeastTenStars,
  isOwnerOfType,
  octokit,
  retrievePackageJsonFilesAndWorkflows,
} from '../../index.mjs';

type GitHubEvent = components['schemas']['event'];

const main = async (): Promise<void> => {
  debug('Start main function');

  const ownerType = getOwnerType();
  const events: GitHubEvent[] = await octokit.paginate('GET /events', { per_page: 100 });
  debug(`${events.length} events received`);

  const currentUser = (await octokit.users.getAuthenticated()).data;
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
          .map(repo => retrievePackageJsonFilesAndWorkflows({ repo, currentUser })),
      );
    })
  ).filter(filterOpinionatedRepoToAnalyse);

  debug(`${contexts.length} repos filtered on package.json, package-lock.json, stars & CI job on pull requests`);

  const reposToFork = contexts.filter(areDependenciesPinnedAndEnginesSet);

  debug(`${reposToFork.length} repos to fork`);

  setOutput('repos', reposToFork.map(contextToOutput));

  debug('End main function');
};

await main();
