import { createClient } from '@supabase/supabase-js';

module.exports = async ({ github, repos, supabaseUrl, supabaseKey }) => {
  const parsedRepos = JSON.parse(repos);

  if (parsedRepos.length === 0) {
    return Promise.resolve();
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  return Promise.all(
    parsedRepos.map(repo =>
      github.rest.repos
        .createFork({
          owner: repo.owner,
          repo: repo.name,
        })
        .then(async () => {
          let inDBRepository = await supabase
            .from('repositories')
            .select('*')
            .eq('name', repo.name)
            .eq('owner', repo.owner)
            .single();

          if (!inDBRepository.data) {
            await supabase.from('repositories').insert([{ name: repo.name, owner: repo.owner, forked: true }]);
          } else {
            await supabase.from('repositories').update({ forked: true }).eq('name', repo.name).eq('owner', repo.owner);
          }
        }),
    ),
  );
};
