# Development Setup

This document should get you up to speed and give you a working development environment for
`transcribee`. The instructions in this document may not be used for production installations!

The transcribee project uses a development-setup managed by `nix`. This allows us to all use the
same software & versions conviniently. Thus, the easiest way to start is to have
[a working nix installation on your system](https://nix.dev/tutorials/install-nix).
Alternatively you can install the dependencies listed in the [`shell.nix`](../shell.nix) file by
hand (but that might be more inconvenient).

## Minimal setup

If you just want to try out `transcribee`, you need to go through the following steps:

1. [Install `nix` on your system](https://nix.dev/tutorials/install-nix) & run `nix-shell` to get
   a shell with all dependencies of `transcribee` installed. Alternatively you can install the
   dependencies listed in the [`shell.nix`](../shell.nix) file by hand
   (but that might be more inconvenient).
2. Run the dev script (this might take a long time as it downloads / compiles all the dependencies):
   execute ```./dev.sh``` in the root folder of the `transcribee` repo.
3. Profit! You can now point your browser to [http://localhost:5173/](http://localhost:5173/) and
   interact with the running transcribee instance. An admin user with the username "admin" and the
   password "admin" is created for you.

## Extended setup

If you do more development on transcribee, you may wish to do the following things:

* Install [`direnv`](https://direnv.net/) for automatically loading the nix-shell when you are in
  the transcribee directory.
* Install the [`pre-commit`](https://pre-commit.com/) hook so that your changes are automatically
  linted before you commit them. Run: ```pre-commit install```

## More!

There are more specific instructions in the respective readme files of the
[`backend/`](../backend/README.md), [`frontend/`](../frontend/README.md)
and [`worker/`](../worker/README.md) directories.
