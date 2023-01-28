import { debug, setOutput } from '@actions/core';
import type { components } from '@octokit/openapi-types';

import {
  areDependenciesPinnedAndEnginesSet,
  Context,
  contextToOutput,
  GitHubRepository,
  filterOpinionatedRepoToAnalyse,
  isNotArchivedAndHaveAtLeastTenStars,
  octokit,
  retrievePackageJsonFilesAndWorkflows,
} from '../../index.mjs';

type GitHubEvent = components['schemas']['event'];

const main = async (): Promise<void> => {
  debug('Start main function');

  const events: GitHubEvent[] = await octokit.paginate('GET /events', { per_page: 100 });
  debug(`${events.length} events received`);

  const currentUser = (await octokit.users.getAuthenticated()).data;
  const contexts: Context[] = (
    await Promise.all(
      events
        .filter(event => event.type === 'PushEvent' || event.type === 'PublicEvent')
        .map(async event => {
          const [owner, repoName] = event.repo.name.split('/');
          return octokit.repos
            .get({
              owner,
              repo: repoName,
            })
            .then(payload => payload.data as GitHubRepository);
        }),
    ).then<Context[]>(payload => {
      return Promise.all(
        payload
          .filter(isNotArchivedAndHaveAtLeastTenStars)
          .map(repo => retrievePackageJsonFilesAndWorkflows({ repo, currentUser })),
      );
    })
  ).filter(filterOpinionatedRepoToAnalyse);

  debug(`${contexts.length} repos filtered on package.json, package-lock.json, stars & CI job on pull requests`);

  const reposToFork = contexts.filter(areDependenciesPinnedAndEnginesSet);

  debug(`${reposToFork.length} repos to fork`);

  if (reposToFork.length > 0) {
    setOutput('repos', reposToFork.map(contextToOutput));
  }

  debug('End main function');
};

await main();
