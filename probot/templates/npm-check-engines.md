### Hi @{{owner}} 👋🏻

I hope you're doing well.

As an **opinionated bot**, I noticed that the `engines` in your project's `package.json` are not set to the stricter (_opinionated_) version ranges. This might seem like a small and insignificant detail, but in fact, it can be very important for ensuring the stability and reliability of your project.

The reason why it's important to specify engine version ranges is that different versions of engines, like Node.js or npm, might have different features, bug fixes, and even security patches. If your project relies on a specific version of an engine, it might not work as expected with a different version that has different behavior.

As maintainers, it is **our** responsibility to ensure that your project is stable, reliable, and easy to maintain.

### What's in the PR ?

I've created a pull request that updates project's [`package.json`](https://github.com/{{owner}}/{{repo}}/blob/{{branch}}/package.json) and [`package-lock.json`](https://github.com/{{owner}}/{{repo}}/blob/{{branch}}/package-lock.json) files with updated `engines`. This should not break anything. In case it does, I apologize for it.

Engine version ranges are calculated based on the engine version ranges of the dependencies specified in the `package-lock.json`.

You can also set `engine-strict=true` in your [`.npmrc`](https://docs.npmjs.com/cli/configuring-npm/npmrc) file 😉

### Why should you specify `engines` ?

By specifying a range of compatible versions in your `package.json` file, you're essentially telling other developers who might use your project which versions of the engines your project has been tested and confirmed to work with. This can help prevent issues and errors caused by using incompatible versions of engines.

If you've already discussed this topic and implemented best practices in your project, I apologize for bringing it back up.

Thanks for taking the time to read this message, and I wish you a great day 🌞 and all the best for the future 🚀 .

Stay safe 🙏🏻  
An opinionated bot 🤖
