import { debug } from '@actions/core';
import { isArray } from 'lodash-es';

import { octokit, octokitBot, supabase } from '../../src/index.mjs';

type PullRequest = {
  id: string;
  kind: string;
  merged: boolean;
  state: string;
  number: number;
  repo: {
    name: string;
    owner: string;
  };
};
type PartialPullRequest = {
  id: string;
  merged: boolean;
  state: string;
};
type PullRequestsResponseSuccess = PullRequest[] | null;
type RepositoriesResponseSuccess =
  | {
      id: string;
      owner: string;
      name: string;
      pull_requests: { state: string }[] | null;
    }[]
  | null;

export const getOpenedPullRequests = (): Promise<PullRequestsResponseSuccess> =>
  supabase
    .from('pull_requests')
    .select('id, kind, merged, state, number, repo(owner, name)')
    .eq('state', 'open')
    .then(payload => payload.data) as any;

export const getRepositoriesWithPullRequestsState = (): Promise<RepositoriesResponseSuccess> =>
  supabase
    .from('repositories')
    .select('id, owner, name, forked, pull_requests(state)')
    .eq('forked', true)
    .then(payload => payload.data) as any;

const main = async (): Promise<void> => {
  debug('Start main function');

  const pullRequests = await getOpenedPullRequests();

  if (!pullRequests) {
    return Promise.resolve();
  }

  debug(`${pullRequests.length} PRs received`);

  const isDefined = (pr: PartialPullRequest | undefined): pr is PartialPullRequest => typeof pr !== 'undefined';
  const pullRequestsToUpdate: PartialPullRequest[] = (
    await Promise.all<PartialPullRequest | undefined>(
      pullRequests.map(pr =>
        octokit.pulls
          .get({
            owner: pr.repo.owner,
            repo: pr.repo.name,
            pull_number: pr.number,
          })
          .then(payload => {
            if (payload.data.state === pr.state && payload.data.merged === pr.merged) {
              return undefined;
            }

            return {
              id: pr.id,
              merged: payload.data.merged,
              state: payload.data.state,
            };
          }),
      ),
    )
  ).filter(isDefined);

  debug(`${pullRequestsToUpdate.length} PRs to update`);

  await Promise.all(
    pullRequestsToUpdate.map(pr =>
      supabase.from('pull_requests').update({ state: pr.state, merged: pr.merged }).eq('id', pr.id).select().single(),
    ),
  );

  const repositories = await getRepositoriesWithPullRequestsState();

  if (!repositories) {
    return Promise.resolve();
  }

  debug(`${repositories.length} repos received`);

  const repositoriesToDelete = repositories.filter(
    repo => isArray(repo.pull_requests) && repo.pull_requests.every(pr => pr.state === 'closed'),
  );

  debug(`${repositoriesToDelete.length} repos to delete`);

  const bot = (await octokitBot.users.getAuthenticated()).data;
  await Promise.all(
    repositoriesToDelete.map(repo =>
      octokitBot.repos
        .delete({
          repo: repo.name,
          owner: bot.login,
        })
        .then(() =>
          supabase.from('repositories').update({ forked: false }).eq('name', repo.name).eq('owner', repo.owner),
        ),
    ),
  );

  debug('End main function');
};

await main();
