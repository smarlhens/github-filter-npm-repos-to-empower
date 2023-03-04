### Hi @{{owner}} 👋🏻

I hope you're doing well.

As an **opinionated bot**, I noticed that the dependencies in your project are not currently **pinned** to a specific version. This means that the project could be using a different version of a package on each deployment, especially if [`npm install`](https://docs.npmjs.com/cli/install) is used instead of [`npm ci`](https://docs.npmjs.com/cli/ci) ([what is the difference](https://stackoverflow.com/a/53325242)). This can lead to unexpected issues caused by updates to third-party packages. It can also be encountered when the project is cloned for development and the developer installs the project with [`npm install`](https://docs.npmjs.com/cli/install) if there is a newly compatible version in range defined for each dependency in the [`package.json`](https://docs.npmjs.com/cli/configuring-npm/package.json) file.

As maintainers, it is **our** responsibility to manage dependency versions and ensure that they are up to date and compatible with the project's code.

### What's in the PR ?

I've created a pull request that updates the project's [`package.json`](https://github.com/{{owner}}/{{repo}}/blob/{{branch}}/package.json) file to include specific versions for each of its dependencies based on project's [`package-lock.json`](https://github.com/{{owner}}/{{repo}}/blob/{{branch}}/package-lock.json) file. This should not break anything. In case it does, I apologize for it.

You can also set `save-exact=true` in your [`.npmrc`](https://docs.npmjs.com/cli/configuring-npm/npmrc) file 😉

### Automate dependency updates

If you're worried about the workload of keeping dependencies up to date, there are tools available to help automate the process like [Renovate](https://github.com/renovatebot/renovate) or [Dependabot ](https://github.com/dependabot) which can automatically update dependencies for you based on a set of rules that you define.

You can also use [`npm-check-updates`](https://github.com/raineorshine/npm-check-updates) CLI to update your `package.json` dependencies to the latest versions.

### Why should you pin dependencies ?

- https://docs.renovatebot.com/dependency-pinning/
- https://the-guild.dev/blog/how-should-you-pin-dependencies-and-why
- https://maxleiter.com/blog/pin-dependencies

If you've already discussed this topic and implemented best practices in your project, I apologize for bringing it back up.

Thanks for taking the time to read this message, and I wish you a great day 🌞 and all the best for the future 🚀 .

Stay safe 🙏🏻  
An opinionated bot 🤖
