import type { components } from '@octokit/openapi-types';
import type { Octokit } from '@octokit/rest';
import detectIndent from 'detect-indent';
import { detectNewline } from 'detect-newline';
import 'dotenv/config';
import editorconfig from 'editorconfig';
import Handlebars from 'handlebars';
import fs from 'node:fs/promises';
import { join, sep } from 'node:path';
import { Context, Probot, ProbotOctokit, Server } from 'probot';

import {
  getRepositories,
  octokitBot,
  shouldPinDependencies,
  shouldSortPackage,
  shouldUpdateEngines,
  supabase,
} from '../src/index.mjs';

type RepositoryFile = components['schemas']['content-file'];
type FileTree = {
  path: string;
  mode: '100644';
  type: 'blob';
  sha: string;
};

const oneMegabyte = 1024 * 1024;
const hundredMegabyte = 100 * oneMegabyte;
const getFile = async ({
  context,
  octokit,
  path,
}: {
  octokit: InstanceType<typeof ProbotOctokit | typeof Octokit>;
  context: Context<'repository'>;
  path: string;
}): Promise<RepositoryFile | undefined> => {
  const repo = context.payload.repository.name;
  const owner = context.payload.repository.owner.login;
  return octokit.repos
    .getContent({
      repo,
      owner,
      path,
    })
    .then(async payload => {
      context.log.debug(`${owner}/${repo}: ${path} found!`);

      const data = payload.data as RepositoryFile;
      const { content, size, encoding } = data;

      if (content === '' && size >= oneMegabyte && size < hundredMegabyte && encoding === 'none') {
        data.content = await context.octokit.repos
          .getContent({
            repo,
            owner,
            path,
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
      context.log.info(`${owner}/${repo}: ${path} not found!`);
      return undefined;
    });
};

const app = (app: Probot): void => {
  const probotOctokit = new ProbotOctokit({
    auth: {
      token: process.env.GITHUB_BOT_TOKEN!,
    },
    log: app.log.child({ name: 'octokit-as-user' }),
  });

  const cwd = process.cwd() + sep;
  const indentSize = ({
    jsonString,
    editorConfigFile,
    filename,
  }: {
    jsonString: string;
    filename: string;
    editorConfigFile?: RepositoryFile | undefined;
  }): '\t' | number | string => {
    const indentFromString = detectIndent(jsonString);
    if (!editorConfigFile) {
      return indentFromString.indent;
    }

    const config = editorconfig.parseFromFilesSync(`${cwd}${filename}`, [
      {
        name: `${cwd}.editorconfig`,
        contents: Buffer.from(editorConfigFile.content, editorConfigFile.encoding === 'base64' ? 'base64' : undefined),
      },
    ]);

    return typeof config.size === 'number' ? config.size : config.size === 'tab' ? '\t' : indentFromString.indent;
  };

  const updateRows = async ({
    url,
    kind,
    repository,
  }: {
    url: string;
    kind: string;
    repository: { name: string; owner: string };
  }): Promise<void> => {
    let inDBRepository = await supabase
      .from('repositories')
      .select('*')
      .eq('name', repository.name)
      .eq('owner', repository.owner)
      .single();

    if (!inDBRepository.data) {
      inDBRepository = await supabase
        .from('repositories')
        .insert([{ name: repository.name, owner: repository.owner }])
        .select()
        .single();
    }

    await supabase
      .from('pull_requests')
      .upsert([
        {
          repo: inDBRepository.data!.id,
          kind,
          merged: false,
          status: 'opened',
          url,
        },
      ])
      .select()
      .single();
  };

  const prepareBase64Content = ({
    jsonString,
    jsonObject,
    filename,
    editorConfigFile,
  }: {
    jsonString: string;
    jsonObject: object;
    filename: string;
    editorConfigFile?: RepositoryFile | undefined;
  }): string => {
    const endCharacters = jsonString.slice(-1) === '\n' ? '\n' : '';
    const newline = detectNewline(jsonString);

    let result =
      JSON.stringify(jsonObject, null, indentSize({ filename, editorConfigFile, jsonString })) + endCharacters;
    if (newline === '\r\n') {
      result = result.replace(/\n/g, newline);
    }

    return Buffer.from(result).toString('base64');
  };

  app.on('repository.created', async context => {
    context.log.info('repository created event received');
    const fullName = context.payload.repository.full_name;

    if (!context.payload.repository.fork) {
      context.log.error(`${fullName}: repository is not a fork!`);
      return;
    }

    const [repositories] = await Promise.all([getRepositories()]);

    const packageJsonFile = await getFile({
      context,
      octokit: context.octokit,
      path: 'package.json',
    });

    if (!packageJsonFile) {
      context.log.error(`${fullName}: package.json is undefined!`);
      return;
    }

    const packageLockJsonFile = await getFile({
      context,
      octokit: context.octokit,
      path: 'package-lock.json',
    });

    if (!packageLockJsonFile) {
      context.log.error(`${fullName}: package-lock.json is undefined!`);
      return;
    }

    let packageJsonString: string = packageJsonFile.content;
    let packageLockString: string = packageLockJsonFile.content;

    if (packageJsonFile!.encoding === 'base64') {
      packageJsonString = Buffer.from(packageJsonString, 'base64').toString();
    }

    if (packageLockJsonFile!.encoding === 'base64') {
      packageLockString = Buffer.from(packageLockString, 'base64').toString();
    }

    const repo = (
      await context.octokit.repos.get({
        repo: context.payload.repository.name,
        owner: context.payload.repository.owner.login,
      })
    ).data;

    if (!repo.source) {
      context.log.error(`${fullName}: repository has no source repository!`);
      return;
    }

    const editorConfigRaw = await getFile({
      context,
      octokit: octokitBot,
      path: '.editorconfig',
    });

    const preparePackageJsonFile = ({ packageJson }: { packageJson: object }) => ({
      path: 'package.json',
      content: prepareBase64Content({
        jsonString: packageJsonString,
        jsonObject: packageJson,
        filename: 'package.json',
        editorConfigFile: editorConfigRaw,
      }),
      sha: packageJsonFile.sha,
    });

    const configs = [
      {
        branch: 'dependency-pinning',
        commit: {
          message: 'chore(npm): pin dependencies',
        },
        pullRequest: {
          title: 'Pin dependencies',
        },
        kind: 'npm-pin-dependencies',
        files: () => {
          const packageJson = shouldPinDependencies({
            repo: context.payload.repository,
            logger: context.log.info,
            packageJsonString,
            packageLockString,
            repositories,
          });

          if (!packageJson) {
            return [];
          }

          return [preparePackageJsonFile({ packageJson })];
        },
      },
      {
        branch: 'npm-package-engines',
        commit: {
          message: 'chore(npm): update package.json engines',
        },
        pullRequest: {
          title: 'Update package.json engines',
        },
        kind: 'npm-check-engines',
        files: () => {
          const payload = shouldUpdateEngines({
            repo: context.payload.repository,
            logger: context.log.info,
            packageJsonString,
            packageLockString,
            repositories,
          });

          if (!payload) {
            return [];
          }

          return [
            preparePackageJsonFile({ packageJson: payload.packageJson }),
            {
              path: 'package-lock.json',
              content: prepareBase64Content({
                jsonString: packageLockString,
                jsonObject: payload.packageLock,
                filename: 'package-lock.json',
                editorConfigFile: editorConfigRaw,
              }),
              sha: packageLockJsonFile.sha,
            },
          ];
        },
      },
      {
        branch: 'sort-package-json',
        commit: {
          message: 'chore(npm): sort package.json',
        },
        pullRequest: {
          title: 'Sort package.json',
        },
        kind: 'sort-package-json',
        files: () => {
          const packageJson = shouldSortPackage({
            repo: context.payload.repository,
            logger: context.log.info,
            packageJsonString,
            repositories,
          });

          if (!packageJson) {
            return [];
          }

          return [preparePackageJsonFile({ packageJson })];
        },
      },
    ];

    await Promise.all(
      configs.map(async config => {
        const files = config.files();
        context.log.info(`${fullName}: ${files.length} files to update`);

        if (files.length === 0) {
          context.log.info(`${fullName}: ignoring ${config.kind}`);
          return Promise.resolve();
        }

        const tree = (
          await context.octokit.git.getTree({
            repo: context.payload.repository.name,
            owner: context.payload.repository.owner.login,
            tree_sha: repo.default_branch,
          })
        ).data;

        const fileTrees = await Promise.all(
          files.map(({ path, content }) =>
            context.octokit.git
              .createBlob({
                repo: context.payload.repository.name,
                owner: context.payload.repository.owner.login,
                content,
                encoding: 'base64',
              })
              .then(blob => {
                return {
                  path,
                  mode: '100644' as const,
                  type: 'blob' as const,
                  sha: blob.data.sha,
                };
              }),
          ),
        );
        const filterUndefined = (file: FileTree | undefined): file is FileTree => !!file;

        const treeData = (
          await context.octokit.git.createTree({
            repo: context.payload.repository.name,
            owner: context.payload.repository.owner.login,
            tree: fileTrees.filter(filterUndefined),
            base_tree: tree.sha,
          })
        ).data;

        const commit = (
          await context.octokit.git.createCommit({
            repo: context.payload.repository.name,
            owner: context.payload.repository.owner.login,
            message: config.commit.message,
            tree: treeData.sha,
            parents: [tree.sha],
          })
        ).data;

        await context.octokit.git.createRef({
          repo: context.payload.repository.name,
          owner: context.payload.repository.owner.login,
          ref: `refs/heads/${config.branch}`,
          sha: commit.sha,
        });

        const template = await fs.readFile(join(process.cwd(), `probot/templates/${config.kind}.md`), 'utf8');
        const compiledTemplate = Handlebars.compile(template)({
          owner: repo.source!.owner.login,
          repo: repo.source!.name,
          branch: repo.default_branch,
        });

        const pullRequest = (
          await probotOctokit.pulls.create({
            title: config.pullRequest.title,
            base: repo.default_branch,
            head: `${context.payload.repository.owner.login}:${config.branch}`,
            repo: repo.source!.name,
            owner: repo.source!.owner.login,
            body: compiledTemplate,
            maintainer_can_modify: true,
          })
        ).data;

        await updateRows({
          url: pullRequest.url,
          kind: config.kind,
          repository: {
            name: repo.source!.name,
            owner: repo.source!.owner.login,
          },
        });
      }),
    );
  });
};

const server = new Server({
  webhookProxy: process.env.WEBHOOK_PROXY_URL!,
  Probot: Probot.defaults({
    appId: process.env.APP_ID!,
    privateKey: process.env.PRIVATE_KEY!,
    secret: process.env.WEBHOOK_SECRET!,
    Octokit: ProbotOctokit.defaults({
      retry: {
        retries: 40,
        retryAfter: 0.25,
        doNotRetry: [400, 401, 403, 422],
      },
    }),
  }),
});

server.load(app).then(() => server.start());
