# Development Setup

This document should get you up to speed and give you a working development environment for
`transcribee`. The instructions in this document may not be used for production installations!

The transcribee project uses a development-setup managed by `nix`. This allows us to all use the
same software & versions conviniently. Thus, the easiest way to start is to have
[a working nix installation on your system](https://nix.dev/tutorials/install-nix).
Alternatively you can install the dependencies listed in the [`shell.nix`](../shell.nix) file by
hand (but that might be more inconvenient).

## Minimal setup (nix)

If you just want to try out `transcribee`, you need to go through the following steps:

1. [Install `nix` on your system](https://nix.dev/tutorials/install-nix) & run `nix develop` to get
   a shell with all dependencies of `transcribee` installed. Alternatively you can install the
   dependencies listed in [`flake.nix`](../flake.nix) and in the files under [`pkgs`](../pkgs) file by hand
   (but that might be more inconvenient).
2. Run the dev script (this might take a long time as it downloads / compiles all the dependencies):
   execute `./packaging/dev.sh` in the root folder of the `transcribee` repo.
3. Profit! You can now point your browser to [http://localhost:5173/](http://localhost:5173/) and
   interact with the running transcribee instance. An admin user with the username "test" and the
   password "test" is created for you.

## Minimal setup (Dev Containers)

[Dev Containers](https://containers.dev/) allow you to use a container as a full-featured development
environment. If your IDE (such as VS Code) supports it, it should offer you an option to build the
dev container and reopen the project within the container. You need to have Docker or another compatible
container runtime installed.

The `transcribee` dev container is based on [nix-devcontainer](https://github.com/xtruder/nix-devcontainer/).
On first run, the dev container will automatically build the nix environment and install dev dependencies,
which may take a while. Subsequent runs or rebuilds will preserve the nix cache and should be much faster.

## Minimal setup (Docker)

If you just want to try out `transcribee` and **not** install nix, you need to go through
the following steps:

1. [Install `Docker` on your system](https://docs.docker.com/get-docker/).
2. Run docker compose: `docker compose -f compose.yml up`
3. Profit! You can now point your browser to [http://localhost:5173/](http://localhost:5173/) and
   interact with the running transcribee instance. An admin user with the username "test" and the
   password "test" is created for you.

> **Note**
> To use this setup for development, you can use the following command to bind-mount your code
> into the container. This way, the application will auto-reload if you change the code, and you
> do not need to restart the container:
>
> ```shell
> `docker compose -f compose.yml -f compose.dev.yml up`
> ```

## Extended setup

If you do more development on transcribee, you may wish to do the following things:

- Install [`direnv`](https://direnv.net/) for automatically loading the nix-shell when you are in
  the transcribee directory.
- Install the [`pre-commit`](https://pre-commit.com/) hook so that your changes are automatically
  linted before you commit them. Run: `pre-commit install`

## Add pages

`transcribee` contains a minimal page system.
To add pages, add a markdown file to `backend/data/pages`.
If the file contains a frontmatter with the `footer_position` attribute, the page is shown in the footer.
To modify the name shown in the footer, set the `name` attribute in the frontmatter.
Example file named `example.md`:

```md
---
footer_position: 1
name: Example Page
---

# Example Page Showing The Page Feature

Lorem Ipsum Dolor Sit Amet....
```

This page would be available at `/pages/example.md` and shown in the footer with a link labelled `Example Page`.

## More!

There are more specific instructions in the respective readme files of the
[`backend/`](../backend/README.md), [`frontend/`](../frontend/README.md)
and [`worker/`](../worker/README.md) directories.
