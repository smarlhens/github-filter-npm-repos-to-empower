import { debug } from '@actions/core';
import type { components } from '@octokit/openapi-types';
import { Octokit } from '@octokit/rest';
import {
  checkEnginesFromString,
  validatePackageJson as checkEnginesValidatePackageJson,
  validatePackageLock as checkEnginesValidatePackageLock,
} from '@smarlhens/npm-check-engines';
import {
  pinDependenciesFromString,
  validatePackageJson as pinDependenciesValidatePackageJson,
  validatePackageLock as pinDependenciesValidatePackageLock,
} from '@smarlhens/npm-pin-dependencies';
import { createClient } from '@supabase/supabase-js';
import isEqual from 'lodash.isequal';
import minimist from 'minimist';
import sortPackageJson from 'sort-package-json';

import type { Database } from './supabase.mjs';

export const octokit = new Octokit({
  auth: process.env.TOKEN,
});

export const supabase = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

type PullRequests =
  | {
      id: string;
      kind: string;
      merged: boolean;
      status: string;
    }[]
  | null;
export type RepositoriesResponseSuccess = {
  id: string;
  name: string;
  owner: string;
  pull_requests: PullRequests;
}[];

export const getRepositories = (): Awaited<RepositoriesResponseSuccess> =>
  supabase.from('repositories').select('id, owner, name, pull_requests(id, kind, merged, status)') as any;

export const argv = minimist(process.argv.slice(2));
const ownerTypes = ['user', 'organization'] as const;
type OwnerTypes = typeof ownerTypes;
type OwnerType = OwnerTypes[number];
export const getOwnerType = (): OwnerType | undefined => {
  let ownerType: OwnerType | undefined = argv['owner-type'];

  if (ownerType && !ownerTypes.includes(ownerType)) {
    ownerType = undefined;
  }

  return ownerType;
};

type RepositoryDirectory = components['schemas']['content-directory'];
type RepositoryFile = components['schemas']['content-file'];
type GitHubUser = components['schemas']['public-user'];
type RepositoryCommit = components['schemas']['commit'];
export type GitHubRepository = components['schemas']['repository'];
export type Context = {
  repo: GitHubRepository;
  packageJsonFile?: RepositoryFile | undefined;
  packageLockJsonFile?: (RepositoryFile & { lastModifiedAt: string | undefined }) | undefined;
  hasCIOnPullRequests?: boolean | undefined;
  isRepoForked?: boolean | undefined;
  hasYarnLock?: boolean | undefined;
  hasPnpmLock?: boolean | undefined;
  hasNpmShrinkwrap?: boolean | undefined;
  hasPullRequestTemplate?: boolean | undefined;
};

const hasFile = async ({
  owner,
  repoName,
  fileName,
}: {
  owner: string;
  repoName: string;
  fileName: string;
}): Promise<boolean> => {
  return octokit.repos
    .getContent({
      owner,
      repo: repoName,
      path: fileName,
    })
    .then(() => {
      debug(`${owner}/${repoName}: ${fileName} found!`);
      return true;
    })
    .catch(() => {
      debug(`${owner}/${repoName}: ${fileName} not found!`);
      return false;
    });
};

const oneMegabyte = 1024 * 1024;
const hundredMegabyte = 100 * oneMegabyte;
const getFile = async ({
  owner,
  repoName,
  fileName,
}: {
  owner: string;
  repoName: string;
  fileName: string;
}): Promise<RepositoryFile | undefined> => {
  return octokit.repos
    .getContent({
      owner,
      repo: repoName,
      path: fileName,
    })
    .then(async payload => {
      debug(`${owner}/${repoName}: ${fileName} found!`);

      const data = payload.data as RepositoryFile;
      const { content, size, encoding } = data;

      if (content === '' && size >= oneMegabyte && size < hundredMegabyte && encoding === 'none') {
        data.content = await octokit.repos
          .getContent({
            owner,
            repo: repoName,
            path: fileName,
            mediaType: {
              format: 'raw',
            },
          })
          .then(payload => payload.data as unknown as string)
          .catch(() => '');
      }

      return data;
    })
    .catch(() => {
      debug(`${owner}/${repoName}: ${fileName} not found!`);
      return undefined;
    });
};

const checkCIOnPullRequests = async ({ repoName, owner }: { owner: string; repoName: string }): Promise<boolean> => {
  const repository = await octokit.repos
    .getContent({
      owner,
      repo: repoName,
      path: '.github/workflows',
    })
    .catch(() => {
      debug(`${owner}/${repoName}: .github/workflows not found!`);
      return undefined;
    });

  if (!repository) {
    return false;
  }

  const workflowPromises: Promise<RepositoryFile | undefined>[] = (repository.data as RepositoryDirectory)
    .filter(file => file.name.endsWith('.yml') || file.name.endsWith('.yaml'))
    .map(file =>
      getFile({
        owner,
        repoName,
        fileName: file.path,
      }),
    );

  const isRepositoryFile = (file: RepositoryFile | undefined): file is RepositoryFile => !!file;
  const workflows: RepositoryFile[] = (await Promise.all<RepositoryFile | undefined>(workflowPromises)).filter(
    isRepositoryFile,
  );
  let found = false;
  for (const workflow of workflows) {
    let workflowString = workflow.content;

    if (workflow.encoding === 'base64') {
      workflowString = atob(workflowString);
    }

    if (workflowString.includes('pull_request')) {
      debug(`${owner}/${repoName}: found a CI workflow that runs on pull requests (${workflow.name})`);
      found = true;
      break;
    }
  }
  if (!found) {
    debug(`${owner}/${repoName}: no CI workflow found that runs on pull requests`);
  }
  return found;
};

const shouldForkToPinDependencies = ({
  packageLockString,
  packageJsonString,
  ctx,
  repositories,
}: {
  packageLockString: string;
  packageJsonString: string;
  ctx: Context;
  repositories: RepositoriesResponseSuccess;
}): boolean => {
  let pinDependenciesValidPackageJson = false;
  try {
    pinDependenciesValidPackageJson = pinDependenciesValidatePackageJson({ packageJsonString });
  } catch (_) {
    debug(`${ctx.repo.full_name}: invalid package.json for pinning dependencies.`);
  }

  let pinDependenciesValidPackageLock = false;
  try {
    pinDependenciesValidPackageLock = pinDependenciesValidatePackageLock({ packageLockString });
  } catch (_) {
    debug(`${ctx.repo.full_name}: invalid package-lock.json for pinning dependencies.`);
  }

  let versionsToPin = [];
  if (pinDependenciesValidPackageJson && pinDependenciesValidPackageLock) {
    ({ versionsToPin } = pinDependenciesFromString({
      packageJsonString,
      packageLockString,
    }));
  }

  if (versionsToPin.length > 0) {
    debug(`${ctx.repo.full_name}: ${versionsToPin.length} dependencies to pin.`);
  }

  return versionsToPin.length > 0 && canForkRepository({ repo: ctx.repo, kind: 'npm-pin-dependencies', repositories });
};

const shouldForkToCheckEngines = ({
  packageLockString,
  packageJsonString,
  ctx,
  repositories,
}: {
  packageLockString: string;
  packageJsonString: string;
  ctx: Context;
  repositories: RepositoriesResponseSuccess;
}): boolean => {
  let checkEnginesValidPackageJson = false;
  try {
    checkEnginesValidPackageJson = checkEnginesValidatePackageJson({ packageJsonString });
  } catch (_) {
    debug(`${ctx.repo.full_name}: invalid package.json for engines check.`);
  }

  let checkEnginesValidPackageLock = false;
  try {
    checkEnginesValidPackageLock = checkEnginesValidatePackageLock({ packageLockString });
  } catch (_) {
    debug(`${ctx.repo.full_name}: invalid package-lock.json for engines check.`);
  }

  let enginesRangeToSet = [];
  if (checkEnginesValidPackageJson && checkEnginesValidPackageLock) {
    ({ enginesRangeToSet } = checkEnginesFromString({
      engines: ['npm', 'node'],
      packageJsonString,
      packageLockString,
    }));
  }

  if (enginesRangeToSet.length > 0) {
    debug(`${ctx.repo.full_name} has ${enginesRangeToSet.length} engine ranges to set.`);
  }

  return enginesRangeToSet.length > 0 && canForkRepository({ repo: ctx.repo, kind: 'npm-check-engines', repositories });
};

const shouldForkToSort = ({
  packageJsonString,
  ctx,
  repositories,
}: {
  packageJsonString: string;
  ctx: Context;
  repositories: RepositoriesResponseSuccess;
}): boolean => {
  const requireFork: boolean = isEqual(JSON.parse(packageJsonString), sortPackageJson(packageJsonString));

  if (requireFork) {
    debug(`${ctx.repo.full_name} has package.json to sort.`);
  }

  return requireFork && canForkRepository({ repo: ctx.repo, kind: 'sort-package-json', repositories });
};

export const areDependenciesPinnedAndEnginesSet = ({
  ctx,
  repositories,
}: {
  ctx: Context;
  repositories: RepositoriesResponseSuccess;
}): boolean => {
  let packageJsonString = ctx.packageJsonFile!.content;
  let packageLockString = ctx.packageLockJsonFile!.content;

  if (ctx.packageJsonFile!.encoding === 'base64') {
    packageJsonString = atob(packageJsonString);
  }

  if (ctx.packageLockJsonFile!.encoding === 'base64') {
    packageLockString = atob(packageLockString);
  }

  return (
    shouldForkToPinDependencies({
      ctx,
      packageJsonString,
      packageLockString,
      repositories,
    }) ||
    shouldForkToCheckEngines({
      ctx,
      packageJsonString,
      packageLockString,
      repositories,
    }) ||
    shouldForkToSort({
      ctx,
      packageJsonString,
      repositories,
    })
  );
};

export const retrievePackageJsonFilesAndWorkflows = async ({
  repo,
  currentUser,
}: {
  repo: GitHubRepository;
  currentUser: GitHubUser;
}): Promise<Context> => {
  const [owner, repoName] = repo.full_name.split('/');
  const [
    packageJsonFile,
    packageLockJsonFile,
    hasCIOnPullRequests,
    isRepoForked,
    hasYarnLock,
    hasPnpmLock,
    hasNpmShrinkwrap,
    hasPullRequestTemplate,
  ] = await Promise.all([
    getFile({ owner, repoName, fileName: 'package.json' }),
    getFile({ owner, repoName, fileName: 'package-lock.json' }).then(async file => {
      if (!file) {
        return undefined;
      }

      const lastCommit: RepositoryCommit = await octokit.repos
        .listCommits({
          path: file!.path,
          owner,
          repo: repoName,
          page: 1,
          per_page: 1,
        })
        .then(payload => payload.data[0] as RepositoryCommit);
      return { ...file, lastModifiedAt: lastCommit.commit.committer!.date! };
    }),
    checkCIOnPullRequests({ owner, repoName }),
    checkIfRepoIsForked({ owner, repoName, currentUser }),
    hasFile({ owner, repoName, fileName: 'yarn.lock' }),
    hasFile({ owner, repoName, fileName: 'pnpm-lock.yaml' }),
    hasFile({ owner, repoName, fileName: 'npm-shrinkwrap.json' }),
    checkIfRepoHasPullRequestTemplate({ owner, repoName }),
  ]);
  return {
    repo,
    packageJsonFile,
    packageLockJsonFile,
    hasCIOnPullRequests,
    isRepoForked,
    hasYarnLock,
    hasPnpmLock,
    hasNpmShrinkwrap,
    hasPullRequestTemplate,
  };
};

export const isOwnerOfType = ({ repo, type }: { repo: GitHubRepository; type: OwnerType }): boolean =>
  repo.owner.type === type;

export const isNotArchivedAndHaveAtLeastTenStars = (repo: GitHubRepository): boolean =>
  !repo.archived && repo.stargazers_count > 10;

export const filterOpinionatedRepoToAnalyse = (ctx: Context): boolean =>
  !!ctx.packageJsonFile &&
  !!ctx.packageLockJsonFile &&
  !!ctx.packageLockJsonFile.lastModifiedAt &&
  new Date().getTime() - new Date(ctx.packageLockJsonFile.lastModifiedAt).getTime() < 15768000000 &&
  !!ctx.hasCIOnPullRequests &&
  !ctx.isRepoForked &&
  !ctx.hasPnpmLock &&
  !ctx.hasYarnLock &&
  !ctx.hasNpmShrinkwrap &&
  !ctx.hasPullRequestTemplate;

export const contextToOutput = (ctx: Context): { name: string; owner: string } => ({
  name: ctx.repo.name,
  owner: ctx.repo.owner.login,
});

const checkIfRepoIsForked = ({
  owner,
  repoName,
  currentUser,
}: {
  owner: string;
  repoName: string;
  currentUser: GitHubUser;
}): Promise<boolean> =>
  octokit
    .request(`GET /repos/${owner}/${repoName}/forks/${currentUser.login}`)
    .then(() => {
      debug(`${owner}/${repoName}: is already forked by ${currentUser.login}`);
      return true;
    })
    .catch(() => {
      debug(`${owner}/${repoName}: is not yet forked by ${currentUser.login}`);
      return false;
    });

export const canForkRepository = ({
  kind,
  repo,
  repositories,
}: {
  kind: string;
  repo: GitHubRepository;
  repositories: RepositoriesResponseSuccess;
}): boolean => {
  return typeof repositories === 'undefined'
    ? false
    : !repositories.some(
        r =>
          r.owner === repo.owner.name &&
          r.name === repo.name &&
          ((r.pull_requests as PullRequests) || []).some(
            pr => pr.kind === kind && pr.status === 'closed' && pr.merged === false,
          ),
      );
};

const checkIfRepoHasPullRequestTemplate = ({
  owner,
  repoName,
}: {
  owner: string;
  repoName: string;
}): Promise<boolean> =>
  octokit.repos
    .getCommunityProfileMetrics({
      owner,
      repo: repoName,
    })
    .then(payload => {
      const hasPullRequestTemplate: boolean = payload.data.files.pull_request_template !== null;
      debug(`${owner}/${repoName}: pull request template${hasPullRequestTemplate ? ' ' : ' not '}found!`);
      return hasPullRequestTemplate;
    })
    .catch(() => {
      debug(`${owner}/${repoName}: pull request template not found!`);
      return false;
    });
