module.exports = async ({ github, context, repos }) => {
  const commentText = JSON.parse(repos)
    .map(repo => `- [${repo.owner}/${repo.name}](https://github.com/${repo.owner}/${repo.name})`)
    .join('\n');

  if (commentText.length === 0) {
    return;
  }

  await github.rest.issues.createComment({
    issue_number: 1,
    owner: context.repo.owner,
    repo: context.repo.repo,
    body: commentText,
  });
};
