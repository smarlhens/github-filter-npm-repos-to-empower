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
import minimist from 'minimist';

import type { Database } from './supabase.mjs';

export const octokit = new Octokit({
  auth: process.env.TOKEN,
});

export const supabase = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!);

export const getRepositories = () => supabase.from('repositories').select('id, owner, name');

type RepositoriesResponse = Awaited<ReturnType<typeof getRepositories>>;
type RepositoriesResponseSuccess = RepositoriesResponse['data'];

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
      debug(`Found a CI workflow in ${owner}/${repoName} that runs on pull requests: ${workflow.name}`);
      found = true;
      break;
    }
  }
  if (!found) {
    debug(`No CI workflow found in ${owner}/${repoName} that runs on pull requests`);
  }
  return found;
};

export const areDependenciesPinnedAndEnginesSet = (ctx: Context): boolean => {
  let packageJsonString = ctx.packageJsonFile!.content;
  let packageLockString = ctx.packageLockJsonFile!.content;

  if (ctx.packageJsonFile!.encoding === 'base64') {
    packageJsonString = atob(packageJsonString);
  }

  if (ctx.packageLockJsonFile!.encoding === 'base64') {
    packageLockString = atob(packageLockString);
  }

  let pinDependenciesValidPackageJson = false;
  try {
    pinDependenciesValidPackageJson = pinDependenciesValidatePackageJson({ packageJsonString });
  } catch (_) {
    debug(`${ctx.repo.full_name} has invalid package.json for pinning dependencies.`);
  }

  let pinDependenciesValidPackageLock = false;
  try {
    pinDependenciesValidPackageLock = pinDependenciesValidatePackageLock({ packageLockString });
  } catch (_) {
    debug(`${ctx.repo.full_name} has invalid package-lock.json for pinning dependencies.`);
  }

  let versionsToPin = [];
  if (pinDependenciesValidPackageJson && pinDependenciesValidPackageLock) {
    ({ versionsToPin } = pinDependenciesFromString({
      packageJsonString,
      packageLockString,
    }));
  }

  if (versionsToPin.length > 0) {
    debug(`${ctx.repo.full_name} has ${versionsToPin.length} dependencies to pin.`);
  }

  let checkEnginesValidPackageJson = false;
  try {
    checkEnginesValidPackageJson = checkEnginesValidatePackageJson({ packageJsonString });
  } catch (_) {
    debug(`${ctx.repo.full_name} has invalid package.json for engines check.`);
  }

  let checkEnginesValidPackageLock = false;
  try {
    checkEnginesValidPackageLock = checkEnginesValidatePackageLock({ packageLockString });
  } catch (_) {
    debug(`${ctx.repo.full_name} has invalid package-lock.json for engines check.`);
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

  return versionsToPin.length > 0 || enginesRangeToSet.length > 0;
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
  !ctx.hasNpmShrinkwrap;

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
      debug(`${currentUser.login} does have a fork of ${owner}/${repoName}`);
      return true;
    })
    .catch(() => {
      debug(`${currentUser.login} does not have a fork of ${owner}/${repoName}`);
      return false;
    });

export const repositoryHasAlreadyBeenCloned = ({
  repo,
  repositories,
}: {
  repo: GitHubRepository;
  repositories: RepositoriesResponseSuccess;
}): boolean => {
  return !repositories?.find(r => r.owner === repo.owner.name && r.name === repo.name);
};
