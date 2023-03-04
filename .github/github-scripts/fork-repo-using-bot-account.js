module.exports = async ({ github, repos }) => {
  const parsedRepos = JSON.parse(repos);

  if (parsedRepos.length === 0) {
    return Promise.resolve();
  }

  return Promise.all(
    parsedRepos.map(repo =>
      github.rest.repos.createFork({
        owner: repo.owner,
        repo: repo.name,
      }),
    ),
  );
};
